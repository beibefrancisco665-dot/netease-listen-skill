import { safeConversation } from './profile.mjs?v=1.3.0';

export const searchInterval = value => Math.max(180, Math.min(7200, Number(value) || 300)) * 1000;
export const shareLimit = value => Math.max(1, Math.min(12, Math.floor(Number(value) || 6)));
const cleanState = () => ({ version: 1, chats: {} });

// Stateful scheduling is separate from chat, playback and liked-song commentary.
// Save before expensive work and before sends; uncertain delivery is never repeated automatically.
export class MusicDiscovery {
  constructor({ load = async () => cleanState(), save = async () => {}, permitted, context, plan, search, inspect, select, like, send, now = Date.now, interval = () => 300000, maxPerHour = () => 6 }) {
    Object.assign(this, { load, save, permitted, context, plan, search, inspect, select, like, send, now, interval, maxPerHour });
    this.state = null; this.running = false; this.closed = false; this.controller = null;
  }
  close() { this.closed = true; this.controller?.abort(); }
  async tick(actor) {
    if (this.closed || this.running) return { skipped: 'busy_or_closed' };
    this.running = true; this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      if (!await this.permitted(actor, signal)) return { skipped: 'not_permitted' };
      this.state ||= await this.load();
      if (this.state.version !== 1 || !this.state.chats || typeof this.state.chats !== 'object' || Array.isArray(this.state.chats)) throw new Error('Invalid discovery ledger');
      const key = `${actor.botId}/${actor.chatKey}`;
      const now = this.now();
      const ledger = this.state.chats[key] ||= { attempts: [], sharedIds: [], queries: [], lastAttempt: null };
      if (!Array.isArray(ledger.attempts) || !Array.isArray(ledger.sharedIds) || !Array.isArray(ledger.queries)) throw new Error('Invalid discovery ledger');
      ledger.attempts = ledger.attempts.filter(at => Number.isFinite(at) && now - at < 3600000);
      if (ledger.lastAttempt !== null && now - ledger.lastAttempt < this.interval() || ledger.attempts.length >= this.maxPerHour()) return { skipped: 'search_cooldown' };
      const context = await this.context(actor, signal);
      if (!context?.roomId || context.playStatus !== 'PLAY') return { skipped: 'no_playing_room' };
      ledger.lastAttempt = now; ledger.attempts.push(now);
      ledger.last = { at: now, outcome: 'searching' };
      await this.save(this.state);
      const plan = await this.plan(context, [...ledger.queries], actor, signal);
      let query = typeof plan?.query === 'string' ? plan.query.trim() : '';
      // Thinking models or gateway truncation can return no JSON. Keep discovery moving
      // with a deterministic, metadata-derived search phrase; never invent a song ID.
      if (!query || query.length > 160) {
        const artist = String(context.song?.artists || '').trim();
        const hobby = String(context.musicHobbies || '').replace(/\s+/g, ' ').slice(0, 80);
        query = artist ? `${artist} 相似歌曲` : (hobby || '网易云 推荐歌曲');
      }
      if (!query || query.length > 160) return await this.finish(ledger, { skipped: 'invalid_query' });
      if (ledger.queries.slice(-3).includes(query)) return await this.finish(ledger, { skipped: 'repeated_query' });
      ledger.queries = [...ledger.queries, query].slice(-12);
      const hits = await this.search(query, actor, signal);
      const candidates = [];
      for (const hit of (Array.isArray(hits) ? hits : []).slice(0, 5)) {
        if (!/^[1-9]\d{0,19}$/.test(String(hit.id)) || ledger.sharedIds.includes(String(hit.id)) || String(hit.id) === context.songId) continue;
        const detail = await this.inspect(String(hit.id), actor, signal);
        if (detail?.playable === true && String(detail.song?.id) === String(hit.id)) candidates.push(detail);
        if (candidates.length >= 3) break;
      }
      if (!candidates.length) return await this.finish(ledger, { skipped: 'no_new_playable_song' });
      const selection = await this.select(context, candidates, actor, signal);
      const chosen = candidates.find(item => item.song.id === selection?.songId);
      // URLs and song identity are generated from the verified candidate, never from model output.
      if (!chosen || !safeConversation(selection?.text) || /https?:|www\.|\[CQ:/i.test(selection.text)) return await this.finish(ledger, { skipped: 'invalid_recommendation' });
      if (this.closed || signal.aborted || !await this.permitted(actor, signal)) return await this.finish(ledger, { skipped: 'permission_changed' });
      const fresh = await this.context(actor, signal);
      if (fresh?.roomId !== context.roomId || fresh.playStatus !== 'PLAY') return await this.finish(ledger, { skipped: 'room_changed' });
      let liked = false, likeCode = null;
      if (selection.like === true && this.like) {
        try { const result = await this.like(chosen.song.id, actor, signal); liked = result?.confirmed === true && result.liked === true; }
        catch (error) { likeCode = /^[a-z_]+$/.test(error?.code || '') ? error.code : 'like_unconfirmed'; }
      }
      if (this.closed || signal.aborted || !await this.permitted(actor, signal)) return await this.finish(ledger, { skipped: 'permission_changed', liked });
      const final = await this.context(actor, signal);
      if (final?.roomId !== context.roomId || final.playStatus !== 'PLAY') return await this.finish(ledger, { skipped: 'room_changed', liked });
      const songId = chosen.song.id;
      const url = `https://music.163.com/#/song?id=${songId}`;
      const title = String(chosen.song.title || '').replace(/[\r\n\[\]]/g, ' ').slice(0, 80);
      const artists = String(chosen.song.artists || '').replace(/[\r\n\[\]]/g, ' ').slice(0, 80);
      const text = `${selection.text.trim()}\n《${title}》 · ${artists}\n${url}`;
      ledger.sharedIds = [...ledger.sharedIds, songId].slice(-200);
      ledger.last = { at: this.now(), outcome: 'send_pending', songId, title, liked, likeCode };
      await this.save(this.state);
      // Reserve song before enqueue; errors can mean delivery happened but the response was lost.
      await this.send(text, actor, signal);
      ledger.last = { ...ledger.last, outcome: 'shared', at: this.now() };
      await this.save(this.state);
      return { shared: true, songId, title, url, liked, likeCode };
    } catch { return { skipped: 'discovery_unavailable' }; }
    finally { this.running = false; this.controller = null; }
  }
  async finish(ledger, result) {
    ledger.last = { at: this.now(), outcome: result.skipped || 'unknown', ...(result.liked === undefined ? {} : { liked: result.liked }) };
    await this.save(this.state); return result;
  }
}
