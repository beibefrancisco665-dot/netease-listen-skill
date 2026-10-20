const HOUR = 3600000;
const DAY = 24 * HOUR;
const finite = (value, fallback) => Number.isFinite(Number(value)) && value !== '' && value != null ? Number(value) : fallback;

export function invitationPolicy(config = {}) {
  const minHours = Math.max(3, Math.min(48, finite(config.invitationMinHours, 3)));
  const maxHours = Math.max(minHours + 1, Math.min(168, finite(config.invitationMaxHours, 6)));
  let quietStart = Math.max(0, Math.min(23, Math.floor(finite(config.invitationQuietStartHour, 23))));
  let quietEnd = Math.max(0, Math.min(23, Math.floor(finite(config.invitationQuietEndHour, 9))));
  if (quietStart === quietEnd) { quietStart = 23; quietEnd = 9; }
  return { enabled: config.proactiveInvitations === true, minMs: minHours * HOUR, maxMs: maxHours * HOUR,
    limit: Math.max(1, Math.min(2, Math.floor(finite(config.maxInvitationsPerDay, 2)))), quietStart, quietEnd };
}

export function quietAt(now, policy) {
  // Fixed Asia/Shanghai clock: independent of the operating system timezone.
  const hour = new Date(now + 8 * HOUR).getUTCHours();
  return policy.quietStart > policy.quietEnd
    ? hour >= policy.quietStart || hour < policy.quietEnd
    : hour >= policy.quietStart && hour < policy.quietEnd;
}

export function safeInvitation(text) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 120) return false;
  if (!/(一起听|一[起块].{0,4}听.{0,3}歌)/.test(text)) return false;
  return !/(https?:|www\.|music\.163\.com|163cn\.tv|\[CQ:|[\r\n]|开.{0,3}房|建.{0,4}房|创建|房间|(?:已经|已|刚刚|刚|给你|帮你).{0,6}(?:加入|播放)|切歌|换歌|暂停|退出|自动邀请|定时|调度|API|必须|赶紧|快点|怎么不回|还不回)/i.test(text);
}

function validateState(value) {
  if (!value || value.version !== 1 || !value.bots || typeof value.bots !== 'object' || Array.isArray(value.bots)) throw new Error('Invalid invitation state');
  for (const bot of Object.values(value.bots)) {
    if (!bot || !Array.isArray(bot.attempts) || bot.attempts.some(at => !Number.isFinite(at) || at < 0)
      || !Number.isFinite(bot.nextAt) || !Number.isFinite(bot.lastObservedAt)
      || !bot.chats || typeof bot.chats !== 'object' || Array.isArray(bot.chats)) throw new Error('Invalid invitation bot state');
    for (const chat of Object.values(bot.chats)) {
      if (!chat || !Number.isFinite(chat.nextAt) || !Number.isFinite(chat.pendingAt) || !Number.isFinite(chat.lastUserTs)) throw new Error('Invalid invitation chat state');
    }
  }
  return value;
}

// No network or filesystem implementation here. Injected operations make long waits testable.
export class InvitationScheduler {
  constructor({ config, load, save, inspect, generate, send, now = Date.now, random = Math.random }) {
    Object.assign(this, { config, load, save, inspect, generate, send, now, random });
    this.closed = false;
    this.pending = new Set();
    this.serial = Promise.resolve();
  }
  close() { this.closed = true; for (const controller of this.pending) controller.abort(); }
  tick(actor) {
    const work = this.serial.then(() => this.run(actor));
    this.serial = work.catch(() => {});
    return work;
  }
  async run(actor) {
    if (this.closed) return { result: 'stopped' };
    const policy = invitationPolicy(this.config());
    if (!policy.enabled) return { result: 'disabled' };
    if (!/^[1-9]\d{0,19}$/.test(String(actor.botId)) || !/^private:[1-9]\d{0,19}$/.test(actor.chatKey) || actor.chatKey === `private:${actor.botId}`) return { result: 'invalid_actor' };
    const controller = new AbortController();
    this.pending.add(controller);
    const live = () => !this.closed && !controller.signal.aborted && invitationPolicy(this.config()).enabled;
    try {
      // Read every time: hot reloads must use the on-disk reservation, never a stale cache.
      const state = validateState(await this.load());
      if (!live()) return { result: 'stopped' };
      const now = this.now();
      const bot = state.bots[actor.botId] ||= { attempts: [], nextAt: 0, lastObservedAt: 0, chats: {} };
      if (now < bot.lastObservedAt) return { result: 'clock_backwards' };
      const delay = () => {
        const sample = Number(this.random());
        const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
        return Math.round(policy.minMs + fraction * (policy.maxMs - policy.minMs));
      };
      let chat = bot.chats[actor.chatKey];
      const persist = async () => { bot.lastObservedAt = this.now(); await this.save(state); };
      if (!chat) {
        chat = bot.chats[actor.chatKey] = { nextAt: now + delay(), pendingAt: 0, lastUserTs: 0 };
        await persist();
        return { result: 'scheduled', nextAt: chat.nextAt };
      }
      if (now < chat.nextAt || now < bot.nextAt) return { result: 'waiting', nextAt: Math.max(chat.nextAt, bot.nextAt) };
      // Consume this opportunity before any slow operation. Never catch up missed sends.
      const overdue = now - chat.nextAt > 120000;
      chat.nextAt = now + delay();
      bot.attempts = bot.attempts.filter(at => now - at < DAY);
      await persist();
      if (!live()) return { result: 'stopped' };
      if (overdue) return { result: 'missed_opportunity', nextAt: chat.nextAt };
      if (quietAt(now, policy)) return { result: 'quiet_hours' };
      if (bot.attempts.length >= policy.limit) return { result: 'daily_limit' };
      const snapshot = await this.inspect(actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (!snapshot?.eligible) return { result: snapshot?.reason || 'unavailable' };
      if (chat.pendingAt) {
        if (snapshot.lastUserTs <= chat.pendingAt) return { result: 'awaiting_reply' };
        // A new user message clears the pending invite; wait a new interval before another.
        chat.pendingAt = 0; chat.lastUserTs = snapshot.lastUserTs;
        await persist();
        return { result: 'reply_observed' };
      }
      const choice = await this.generate(snapshot, actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (choice?.speak !== true || !safeInvitation(choice.text)) return { result: 'model_silent' };
      // Re-check online identity, room, permissions and the exact conversation after generation.
      const current = await this.inspect(actor, controller.signal);
      if (!live()) return { result: 'stopped' };
      if (!current?.eligible || current.fingerprint !== snapshot.fingerprint) return { result: 'context_changed' };
      const sendAt = this.now();
      const latest = invitationPolicy(this.config());
      if (sendAt < now || quietAt(sendAt, latest) || sendAt - now > 120000) return { result: 'opportunity_expired' };
      if (bot.attempts.filter(at => sendAt - at < DAY).length >= latest.limit) return { result: 'daily_limit' };
      // Reserve before delivery. A timeout or crash consumes a slot and keeps pendingAt.
      bot.attempts.push(sendAt);
      bot.nextAt = sendAt + Math.max(latest.minMs, delay());
      chat.nextAt = Math.max(chat.nextAt, bot.nextAt);
      chat.pendingAt = sendAt; chat.lastUserTs = current.lastUserTs;
      chat.delivery = 'unknown';
      await persist();
      if (!live()) return { result: 'stopped' };
      try {
        await this.send(choice.text.trim(), actor, controller.signal, current);
      } catch { return { result: 'delivery_unknown' }; }
      chat.delivery = 'sent';
      await persist();
      return { result: 'invited', nextAt: chat.nextAt };
    } finally { this.pending.delete(controller); }
  }
}
