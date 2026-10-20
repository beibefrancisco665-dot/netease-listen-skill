import test from 'node:test';
import assert from 'node:assert/strict';
import { InvitationScheduler, invitationPolicy, quietAt, safeInvitation } from '../skills/netease-listen-together/1016_随机邀请调度_v1.mjs';
import * as skill from '../skills/netease-listen-together/index.js';
import { fixture } from '../bridge/test/fixtures.mjs';

const HOUR = 3600000;
const actor = { botId: '777', chatKey: 'private:123' };
function scheduled(options = {}) {
  let time = Date.parse('2026-10-20T01:00:00Z'); // 北京时间 09:00
  let state = { version: 1, bots: {} }, sent = 0;
  let snapshot = { eligible: true, fingerprint: 'stable', lastUserTs: time - HOUR };
  const scheduler = new InvitationScheduler({
    config: () => ({ proactiveInvitations: true }), now: () => time, random: () => 0,
    load: async () => structuredClone(state), save: async value => { state = structuredClone(value); },
    inspect: async () => snapshot,
    generate: async () => ({ speak: true, text: '要不要一起听会儿歌？' }),
    send: async () => { sent++; if (options.failSend) throw Error('模拟发送超时'); }
  });
  return { scheduler, state: () => state, sent: () => sent, at: value => { time = value; }, now: () => time,
    snapshot: value => { snapshot = { ...snapshot, ...value }; } };
}

test('邀请间隔与上限有硬限制，静默时间按北京时间判断', () => {
  const p = invitationPolicy({ invitationMinHours: 0, invitationMaxHours: 0, maxInvitationsPerDay: 99 });
  assert.equal(p.minMs, 3 * HOUR); assert.equal(p.maxMs, 4 * HOUR); assert.equal(p.limit, 2);
  assert.equal(quietAt(Date.parse('2026-10-20T15:00:00Z'), p), true);
  assert.equal(quietAt(Date.parse('2026-10-20T01:00:00Z'), p), false);
});
test('首次只随机排期，不在启用时立即发送', async () => {
  const f = scheduled();
  assert.equal((await f.scheduler.tick(actor)).result, 'scheduled');
  assert.equal(f.state().bots['777'].chats['private:123'].nextAt, f.now() + 3 * HOUR);
  assert.equal(f.sent(), 0);
});
test('发送前保留次数，无回应即使到期也不追问', async () => {
  const f = scheduled(); await f.scheduler.tick(actor);
  f.at(f.now() + 3 * HOUR); assert.equal((await f.scheduler.tick(actor)).result, 'invited');
  assert.equal(f.state().bots['777'].attempts.length, 1);
  f.at(f.now() + 3 * HOUR); assert.equal((await f.scheduler.tick(actor)).result, 'awaiting_reply');
  assert.equal(f.sent(), 1);
});
test('发送超时占用次数，后续不自动重发', async () => {
  const f = scheduled({ failSend: true }); await f.scheduler.tick(actor);
  f.at(f.now() + 3 * HOUR); assert.equal((await f.scheduler.tick(actor)).result, 'delivery_unknown');
  assert.equal(f.state().bots['777'].attempts.length, 1);
  assert.equal(f.state().bots['777'].chats['private:123'].delivery, 'unknown');
  assert.equal((await f.scheduler.tick(actor)).result, 'waiting'); assert.equal(f.sent(), 1);
});
test('多个收件人共用机器人24小时上限', async () => {
  const f = scheduled(); const second = { ...actor, chatKey: 'private:456' }, third = { ...actor, chatKey: 'private:789' };
  for (const item of [actor, second, third]) await f.scheduler.tick(item);
  f.at(f.now() + 3 * HOUR); await f.scheduler.tick(actor); await f.scheduler.tick(second);
  f.at(f.now() + 3 * HOUR); assert.equal((await f.scheduler.tick(second)).result, 'missed_opportunity');
  f.at(f.state().bots['777'].chats['private:456'].nextAt); assert.equal((await f.scheduler.tick(second)).result, 'invited');
  // 不模拟生成新邀请机会绕过静默：直接使用同一限频状态中已排好的下一机会。
  const stored = f.state(); stored.bots['777'].chats['private:789'].nextAt = f.now();
  const limited = new InvitationScheduler({ config: () => ({ proactiveInvitations: true }), now: f.now,
    load: async () => stored, save: async () => {}, inspect: async () => { throw Error('达到限额不应继续检查或发送'); } });
  // Bot cooldown expires at北京时间21:00，仍处于允许窗口。
  f.at(f.now() + 3 * HOUR); stored.bots['777'].chats['private:789'].nextAt = f.now();
  assert.equal((await limited.tick(third)).result, 'daily_limit'); assert.equal(f.sent(), 2);
});
test('仅自然语言意愿邀请可发送，不能伪称已经开房或携带链接', () => {
  assert.equal(safeInvitation('要不要一起听会儿歌？'), true);
  for (const text of ['一起听吧，房间已经开好了', '一起听 https://music.163.com/', '一起听\n快点']) assert.equal(safeInvitation(text), false);
});
test('用户主动create通过现有工具创建房间，保留已用自主邀请次数', async () => {
  const f = scheduled(); await f.scheduler.tick(actor);
  f.at(f.now() + 3 * HOUR); await f.scheduler.tick(actor);
  const before = structuredClone(f.state());
  const music = fixture(), tools = [];
  skill.setup({ config: () => ({ bridgeUrl: 'http://127.0.0.1:32630', bridgeToken: 'test-only', allowedChats: 'private:123' }),
    registerTool: def => tools.push(def), fetch: () => { throw Error('禁止公网'); },
    capability: async (_name, { url, init }) => {
      assert.equal(new URL(url).pathname, '/v1/create');
      const input = JSON.parse(init.body); assert.equal(input.chatKey, actor.chatKey);
      music.together.connect({ botId: actor.botId, allowedChats: [actor.chatKey] });
      return new Response(JSON.stringify({ ok: true, data: await music.together.enter(actor.chatKey, { songId: input.songId }) }));
    } });
  try {
    const result = await tools.find(t => t.id === 'create').execute({ chatKey: actor.chatKey, onebot: { connected: true, selfId: actor.botId } }, { songId: '1001' });
    assert(!result.isError); assert.equal(music.state.inRoom, true); assert.deepEqual(f.state(), before);
  } finally { skill.dispose(); }
});
