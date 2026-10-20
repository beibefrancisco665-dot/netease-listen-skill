import { safeConversation } from './profile.mjs';

export class LikedSongListener {
  constructor({ snapshot, generate, send, permitted, idle, now = Date.now, interval = () => 180000 }) {
    Object.assign(this, { snapshot, generate, send, permitted, idle, now, interval });
    this.seen = new Set(); this.attempts = []; this.running = false; this.closed = false;
    this.controller = null; this.lastAttempt = -Infinity;
  }
  close() { this.closed = true; this.controller?.abort(); }
  async tick(actor) {
    if (this.running || this.closed || !await this.permitted(actor) || !this.idle(actor)) return { skipped: 'inactive_or_busy' };
    const now = this.now();
    this.attempts = this.attempts.filter(time => now - time < 3600000);
    if (now - this.lastAttempt < this.interval() || this.attempts.length >= 3) return { skipped: 'cooldown' };
    this.running = true; this.controller = new AbortController();
    try {
      const current = await this.snapshot(actor);
      const key = JSON.stringify([actor.botId, actor.chatKey, current?.roomId, current?.songId]);
      if (!current || current.playStatus !== 'PLAY' || !current.liked || this.seen.has(key)) return { skipped: 'not_new_liked_song' };
      this.lastAttempt = now; this.attempts.push(now);
      const generated = await this.generate(current, actor, this.controller.signal);
      if (this.closed || this.controller.signal.aborted || !generated?.speak || !safeConversation(generated.text)) return { skipped: 'no_safe_conversation' };
      if (!await this.permitted(actor) || !this.idle(actor)) return { skipped: 'permission_or_activity_changed' };
      const latest = await this.snapshot(actor);
      if (!latest || latest.roomId !== current.roomId || latest.songId !== current.songId || latest.playStatus !== 'PLAY' || !latest.liked) return { skipped: 'song_changed' };
      // Mark before enqueue: delivery can become uncertain; never automatically duplicate.
      this.seen.add(key); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
      await this.send(actor, generated.text);
      return { sent: true };
    } catch { return { skipped: 'request_failed' }; }
    finally { this.running = false; this.controller = null; }
  }
}

export class AutonomousLikeListener {
  constructor({ snapshot, decide, likeSong, permitted, idle, now = Date.now, interval = () => 180000, maxPerHour = () => 6 }) {
    Object.assign(this, { snapshot, decide, likeSong, permitted, idle, now, interval, maxPerHour });
    this.seen = new Set(); this.attempts = []; this.running = false; this.closed = false; this.controller = null; this.lastLike = -Infinity; this.lastEvaluation = -Infinity;
  }
  close() { this.closed = true; this.controller?.abort(); }
  async tick(actor) {
    if (this.running || this.closed || !await this.permitted(actor) || !this.idle(actor)) return { skipped: 'inactive_or_busy' };
    const now = this.now(); this.attempts = this.attempts.filter(time => now - time < 3600000);
    if (now - this.lastEvaluation < this.interval() || this.attempts.length >= this.maxPerHour()) return { skipped: 'like_cooldown' };
    this.running = true; this.controller = new AbortController();
    try {
      const current = await this.snapshot(actor);
      const key = JSON.stringify([actor.botId, actor.chatKey, current?.roomId, current?.songId]);
      if (!current || current.playStatus !== 'PLAY' || current.liked !== false || this.seen.has(key)) return { skipped: 'not_new_unliked_song' };
      this.attempts.push(now); this.lastEvaluation = now;
      const decision = await this.decide(current, actor, this.controller.signal);
      if (this.closed || this.controller.signal.aborted || decision?.like !== true) { this.seen.add(key); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value); return { skipped: 'not_selected' }; }
      if (!await this.permitted(actor) || !this.idle(actor)) return { skipped: 'permission_or_activity_changed' };
      const latest = await this.snapshot(actor);
      if (!latest || latest.roomId !== current.roomId || latest.songId !== current.songId || latest.playStatus !== 'PLAY' || latest.liked) return { skipped: 'song_changed' };
      if (this.closed || this.controller.signal.aborted) return { skipped: 'stopped' };
      this.seen.add(key); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
      await this.likeSong(actor, current.songId);
      const after = await this.snapshot(actor);
      if (!after || after.roomId !== current.roomId || after.songId !== current.songId || after.liked !== true) return { skipped: 'like_unconfirmed' };
      this.lastLike = now; this.seen.add(key); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
      return { liked: true };
    } catch { return { skipped: 'like_failed' }; }
    finally { this.running = false; this.controller = null; }
  }
}
