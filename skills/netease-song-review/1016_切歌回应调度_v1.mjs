const HOUR = 3600000;
export function reactionPolicy(config = {}) {
  const number = (value, fallback) => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
  return { enabled: config.reactToSongChanges === true,
    stableMs: Math.max(10, Math.min(60, number(config.songChangeStableSeconds, 10))) * 1000,
    intervalMs: Math.max(60, Math.min(3600, number(config.songChangeReplyIntervalSeconds, 60))) * 1000,
    limit: Math.max(1, Math.min(6, Math.floor(number(config.maxSongChangeRepliesPerHour, 6)))), maxAgeMs: 90000 };
}

export function safeReaction(text, source = 'unknown') {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 160) return false;
  if (/[\r\n]|https?:|www\.|\[CQ:|开.{0,3}房|建.{0,4}房|API|调度|自动检测/i.test(text)) return false;
  if (/(?:请|帮我|给我|要不|不如|赶紧|快点|能不能|再来).{0,10}(?:切|换|暂停|退出|收藏)|(?:切|换|来|听|播放).{0,4}(?:下一首|上一首)|(?:点歌|取消收藏|结束一起听)/.test(text)) return false;
  // The pair API does not reliably identify a remote operator. Never invent attribution.
  if (source !== 'user' && /(?:你|您).{0,8}(?:切|换|跳过|选了|点了)|(?:是你|被你).{0,8}(?:切|换)/.test(text)) return false;
  return true;
}

function validate(value) {
  if (value?.version !== 1 || !value.bots || typeof value.bots !== 'object' || Array.isArray(value.bots)) throw new Error('Invalid switch-reaction state');
  for (const bot of Object.values(value.bots)) {
    if (!bot || !Array.isArray(bot.attempts) || bot.attempts.some(at => !Number.isFinite(at)) || !Number.isFinite(bot.lastAttemptAt)
      || (bot.deliveries != null && (!Array.isArray(bot.deliveries) || bot.deliveries.some(at => !Number.isFinite(at))))
      || (bot.lastSentAt != null && !Number.isFinite(bot.lastSentAt))
      || !bot.chats || typeof bot.chats !== 'object' || Array.isArray(bot.chats)) throw new Error('Invalid switch-reaction bot');
    for (const chat of Object.values(bot.chats)) {
      if (!chat || !Array.isArray(chat.handled) || typeof chat.roomId !== 'string' || typeof chat.songId !== 'string') throw new Error('Invalid switch-reaction chat');
      if (chat.pending && (typeof chat.pending.id !== 'string' || !Number.isFinite(chat.pending.stableSince) || !Number.isFinite(chat.pending.observedAt))) throw new Error('Invalid switch-reaction pending event');
    }
  }
  return value;
}

export class SongChangeReactor {
  constructor({ config, load, save, snapshot, permitted, context, generate, send, reserve = () => {}, alreadyHandled = () => false, now = Date.now }) {
    Object.assign(this, { config, load, save, snapshot, permitted, context, generate, send, reserve, alreadyHandled, now });
    this.closed = false; this.controllers = new Set(); this.initialized = new Set(); this.owned = new Map(); this.serial = Promise.resolve();
  }
  close() { this.closed = true; this.owned.clear(); for (const controller of this.controllers) controller.abort(); }
  ownsSong(chatKey, roomId, songId) { const value = this.owned.get(chatKey); return value?.roomId === roomId && value.songId === songId; }
  tick(actor) { const work = this.serial.then(() => this.run(actor)); this.serial = work.catch(() => {}); return work; }
  async run(actor) {
    const policy = reactionPolicy(this.config());
    if (this.closed || !policy.enabled) return { result: 'disabled' };
    if (!/^[1-9]\d{0,19}$/.test(actor.botId) || !/^private:[1-9]\d{0,19}$/.test(actor.chatKey) || actor.chatKey === `private:${actor.botId}`) return { result: 'invalid_actor' };
    const controller = new AbortController(); this.controllers.add(controller);
    const live = () => !this.closed && !controller.signal.aborted && reactionPolicy(this.config()).enabled;
    try {
      const state = validate(await this.load());
      if (!live()) return { result: 'stopped' };
      const wasNew = !state.bots[actor.botId];
      const bot = state.bots[actor.botId] ||= { attempts: [], lastAttemptAt: 0, chats: {} };
      bot.deliveries ||= []; bot.lastSentAt ||= 0;
      if (this.now() < bot.lastAttemptAt) return { result: 'clock_backwards' };
      let chat = bot.chats[actor.chatKey];
      const key = `${actor.botId}/${actor.chatKey}`;
      const current = await this.snapshot(actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (!current?.roomId || !current.songId) {
        this.initialized.delete(key); this.owned.delete(actor.chatKey);
        if (chat) { delete bot.chats[actor.chatKey]; await this.save(state); }
        else if (wasNew) await this.save(state);
        return { result: 'no_valid_room' };
      }
      if (!this.initialized.has(key) || !chat || chat.roomId !== current.roomId) {
        this.initialized.add(key); this.owned.delete(actor.chatKey);
        chat = bot.chats[actor.chatKey] = { roomId: current.roomId, songId: current.songId,
          eventId: current.songChange?.id || '', pending: null, handled: chat?.roomId === current.roomId ? chat.handled : [] };
        await this.save(state); return { result: 'baseline' };
      }
      const remember = eventId => { if (!chat.handled.includes(eventId)) chat.handled.push(eventId); chat.handled = chat.handled.slice(-128); };
      if (chat.songId !== current.songId) {
        const event = current.songChange;
        chat.songId = current.songId; chat.pending = null; this.owned.delete(actor.chatKey);
        if (event?.id && event.toSongId === current.songId && event.id !== chat.eventId && !chat.handled.includes(event.id)) {
          chat.eventId = event.id;
          const age = this.now() - event.observedAt;
          if (event.source !== 'qqa' && age >= 0 && age <= policy.maxAgeMs) {
            chat.pending = { ...event, stableSince: this.now() };
            this.owned.set(actor.chatKey, { roomId: current.roomId, songId: current.songId });
          } else remember(event.id);
        }
        await this.save(state);
        return { result: chat.pending ? 'stabilizing' : 'own_or_stale_change' };
      }
      const event = chat.pending;
      if (!event) { this.owned.delete(actor.chatKey); return { result: 'unchanged' }; }
      const consume = async result => {
        remember(event.id); chat.pending = null; this.owned.delete(actor.chatKey); chat.lastResult = result; await this.save(state); return { result };
      };
      if (this.now() - event.observedAt > policy.maxAgeMs || this.now() < event.stableSince) return consume('expired');
      if (current.playStatus !== 'PLAY') return consume('paused');
      if (this.now() - event.stableSince < policy.stableMs) return { result: 'stabilizing' };
      bot.attempts = bot.attempts.filter(at => this.now() - at < HOUR);
      bot.deliveries = bot.deliveries.filter(at => this.now() - at < HOUR);
      if (this.now() - Math.max(bot.lastAttemptAt, bot.lastSentAt) < policy.intervalMs
        || bot.attempts.length >= policy.limit || bot.deliveries.length >= policy.limit) return consume('rate_limited');
      if (this.alreadyHandled(actor, current.roomId, current.songId, event.observedAt)) return consume('already_discussed');
      const gate = await this.permitted(actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (!gate?.allowed) return consume('busy_or_not_permitted');
      const brief = await this.context(actor, event, controller.signal);
      const confirmed = await this.snapshot(actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (!brief || brief.roomId !== current.roomId || brief.songId !== current.songId || !confirmed || confirmed.songId !== current.songId
        || confirmed.roomId !== current.roomId || confirmed.musicUid !== current.musicUid || confirmed.songChange?.id !== event.id || confirmed.playStatus !== 'PLAY') return consume('changed_before_generation');
      // Persist event consumption and the attempt before model/delivery. No retry after ambiguity.
      bot.lastAttemptAt = this.now(); bot.attempts.push(bot.lastAttemptAt); remember(event.id);
      chat.pending = null; chat.lastResult = 'reserved';
      await this.save(state);
      this.reserve(actor, current.roomId, current.songId);
      if (!live()) return { result: 'stopped' };
      const generated = await this.generate({ event, brief, gate }, actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (generated?.speak !== true || !safeReaction(generated.text, event.source)) return consume('model_silent_or_unsafe');
      const latestGate = await this.permitted(actor, controller.signal);
      const latest = await this.snapshot(actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (!latestGate?.allowed || latestGate.fingerprint !== gate.fingerprint || !latest || latest.roomId !== current.roomId
        || latest.songId !== current.songId || latest.musicUid !== current.musicUid || latest.songChange?.id !== event.id || latest.playStatus !== 'PLAY'
        || this.now() - event.observedAt > policy.maxAgeMs) return consume('changed_before_send');
      const latestPolicy = reactionPolicy(this.config());
      bot.deliveries = bot.deliveries.filter(at => this.now() - at < HOUR);
      if (this.now() - bot.lastSentAt < latestPolicy.intervalMs || bot.deliveries.length >= latestPolicy.limit) return consume('rate_limited');
      bot.deliveries.push(this.now());
      chat.lastResult = 'delivery_unknown'; await this.save(state);
      if (!live()) return { result: 'stopped' };
      try { await this.send(generated.text.trim(), actor, controller.signal, { event, roomId: current.roomId, songId: current.songId, gate }); }
      catch {
        bot.lastSentAt = this.now(); bot.deliveries[bot.deliveries.length - 1] = this.now();
        await this.save(state); this.owned.delete(actor.chatKey); return { result: 'delivery_unknown' };
      }
      bot.lastSentAt = this.now(); bot.deliveries[bot.deliveries.length - 1] = this.now();
      return consume('sent');
    } finally { this.controllers.delete(controller); }
  }
}
