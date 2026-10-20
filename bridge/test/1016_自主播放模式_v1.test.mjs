function setupFixture(api){return skill.setup({...api,capability:(_name,{url,init})=>api.fetch(url,init)});}
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture } from './fixtures.mjs';
import { modePolicy, listCommand, quota } from '../src/1016_播放模式_v1.mjs';
import { createModeRuntime } from '../../skills/netease-listen-together/1016_自主模式运行时_v1.mjs';
import * as skill from '../../skills/netease-listen-together/index.js';
import { bridgeServer } from '../src/server.mjs';
import { createOneBotAuthorizer } from '../src/onebot-link.mjs';
const policy = modePolicy({ autonomousMusic: true, autonomousPlayModes: true });
function sample() {
  const f = fixture();
  let time = 1800000000000;
  f.state.inRoom = true; f.state.mode = 'ORDER_LOOP'; f.state.random = []; f.state.versions = [{ userId: '123', version: 10 }, { userId: '999', version: 80 }];
  f.together.now = () => time;
  f.together.room = { protocol: 'pair', id: f.state.roomId, uid: '123', botId: '777', chatKey: 'private:123' };
  f.together.connect({ botId: '777', allowedChats: ['private:123'] });
  f.together.saveModeState = async value => { f.state.savedMode = structuredClone(value); };
  const original = f.client.pair.bind(f.client);
  f.client.pair = async (action, args) => {
    const result = await original(action, args);
    if (action === 'status' && result.roomInfo) result.roomInfo.roomUsers.push({ userId: '999' });
    if (action === 'playlist') Object.assign(result.playlist, { playMode: f.state.mode, randomList: { result: f.state.random }, version: f.state.versions, listMode: '' });
    if (action === 'sync' && !f.state.rejectWrite && !f.state.delayedWrite) {
      const p = JSON.parse(args.playlistParam);
      f.state.mode = p.playMode || f.state.mode; f.state.random = p.randomList; f.state.versions = p.version;
    }
    return result;
  };
  return { ...f, advance: value => { time += value; }, clock: () => time };
}
for (const [mode, expected] of [['single', 'SINGLE_LOOP'], ['list', 'ORDER_LOOP'], ['random', 'RANDOM']]) {
  test('manual mode ' + mode + ' reads back without changing song or display list', async () => {
    const f = sample(), before = [...f.state.queue];
    const result = await f.together.setPlayMode('private:123', { mode }, policy);
    assert.equal(result.confirmed, true); assert.equal(result.playMode, expected);
    assert.deepEqual(f.state.queue, before); assert.equal(f.state.songId, '1001'); assert.equal(f.state.playStatus, 'PLAY');
    assert.equal(f.together.modeState.bots['777'], undefined);
    assert.equal(f.together.room.modeObservation.manualUntil, f.clock() + 3600000);
  });
}
test('automatic cooldown is ten minutes and hard hourly maximum is three', async () => {
  const f = sample();
  assert.equal((await f.together.setPlayMode('private:123', { mode: 'single', automatic: true }, policy)).confirmed, true);
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'random', automatic: true }, policy), { code: 'mode_rate_limited' });
  f.advance(600000); await f.together.setPlayMode('private:123', { mode: 'random', automatic: true }, policy);
  f.advance(600000); await f.together.setPlayMode('private:123', { mode: 'list', automatic: true }, policy);
  f.advance(600000); await assert.rejects(f.together.setPlayMode('private:123', { mode: 'single', automatic: true }, policy), { code: 'mode_rate_limited' });
  assert.equal(f.together.modeState.bots['777'].attempts.length, 3);
  f.together.modeState = JSON.parse(JSON.stringify(f.state.savedMode));
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'single', automatic: true }, policy), { code: 'mode_rate_limited' });
  f.advance(1800000); assert.equal((await f.together.setPlayMode('private:123', { mode: 'single', automatic: true }, policy)).confirmed, true);
  assert.equal(f.together.modeState.bots['777'].attempts.length, 3);
});
test('manual command does not consume autonomous quota and protects mode for one hour', async () => {
  const f = sample();
  await f.together.setPlayMode('private:123', { mode: 'single' }, policy);
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'random', automatic: true }, policy), { code: 'manual_mode_hold' });
  assert.equal(Object.keys(f.together.modeState.bots).length, 0);
  f.advance(3600000); assert.equal((await f.together.setPlayMode('private:123', { mode: 'random', automatic: true }, policy)).confirmed, true);
});
test('external mode changes produce a persisted manual hold', async () => {
  const f = sample(); await f.together.modeStateFor('private:123', policy);
  f.state.mode = 'SINGLE_LOOP';
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'random', automatic: true }, policy), { code: 'manual_mode_hold' });
  assert.equal(f.state.saved.modeObservation.manualUntil, f.clock() + 3600000);
});
test('unknown write consumes one attempt and is never retried', async () => {
  const f = sample(); f.state.delayedWrite = true;
  const result = await f.together.setPlayMode('private:123', { mode: 'single', automatic: true }, policy);
  assert.equal(result.confirmed, false); assert.equal(f.state.savedMode.bots['777'].attempts.length, 1);
  const writes = f.state.calls.filter(c => c.uri.endsWith('/sync/list/command/report'));
  assert.equal(writes.length, 1);
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'random', automatic: true }, policy), { code: 'mode_rate_limited' });
});
test('persistence failure blocks upstream mutation', async () => {
  const f = sample(); f.together.saveModeState = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'single', automatic: true }, policy));
  assert.equal(f.state.calls.filter(c => c.uri.endsWith('/sync/list/command/report')).length, 0);
});
test('stale decisions and unsupported mode fail before write', async () => {
  const f = sample();
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'random', automatic: true, expectedMode: 'SINGLE_LOOP' }, policy), { code: 'mode_context_changed' });
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'invented' }, policy), { code: 'invalid_play_mode' });
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'random', automatic: true }, { ...policy, allowed: false }), { code: 'autonomous_mode_disabled' });
  assert.equal(f.state.calls.filter(c => c.uri.endsWith('/sync/list/command/report')).length, 0);
});
test('list changes during decision are not overwritten', async () => {
  const f = sample(), original = f.client.pair;
  let reads = 0;
  f.client.pair = async (...args) => { if (args[0] === 'playlist' && ++reads === 2) f.state.queue.push('1003'); return original(...args); };
  await assert.rejects(f.together.setPlayMode('private:123', { mode: 'single', automatic: true }, policy), { code: 'mode_context_changed' });
  assert.deepEqual(f.state.queue, ['1001', '1002', '1003']);
});
test('random permutation and other participant versions are preserved', () => {
  const snapshot = { ids: ['1', '2', '3'], randomIds: [], mode: 'ORDER_LOOP', version: [{ userId: '5', version: 99 }, { userId: '6', version: 200 }] };
  const p = listCommand(snapshot, '5', 20, { mode: 'RANDOM', random: () => 0.1 });
  assert.deepEqual(p.displayList, ['1', '2', '3']); assert.deepEqual([...p.randomList].sort(), ['1', '2', '3']);
  assert.equal(p.version.find(v => v.userId === '5').version, 100); assert.equal(p.version.find(v => v.userId === '6').version, 200);
});
test('adding a song preserves an existing loop mode', async () => {
  const f = sample(); f.state.mode = 'SINGLE_LOOP';
  await f.together.modeStateFor('private:123', policy); await f.together.syncList(['1001', '1002', '1003']);
  assert.equal(f.state.mode, 'SINGLE_LOOP');
});
test('policy clamps and future timestamps prevent quota bypass', () => {
  const p = modePolicy({ autonomousMusic: true, autonomousPlayModes: true, modeSwitchIntervalMinutes: 1, maxModeSwitchesPerHour: 99 });
  assert.equal(p.intervalMs, 600000); assert.equal(p.maxPerHour, 3);
  assert.equal(quota({ bots: { '777': { attempts: [2000000], lastAttemptAt: 2000000 } } }, '777', 1000000, p).allowed, false);
});
function runtimeSample(overrides = {}) {
  let time = 1800000000000, calls = [], generated = 0, changed = false;
  const c = { autonomousMusic: true, autonomousPlayModes: true, bridgeUrl: 'http://127.0.0.1:32630', bridgeToken: 'fixture', allowedChats: 'private:123' };
  const actor = { botId: '777', chatKey: 'private:123', ctx: { chatKey: 'private:123' } };
  const request = async (url, options = {}) => {
    const route = new URL(url).pathname; calls.push(route);
    let body;
    if (route === '/api/status') body = { onebot: { connected: true, self: { userId: '777' } }, orchestrator: { running: [] } };
    else if (route === '/api/skills') body = { skills: [{ id: 'netease-listen-together', active: true, settings: c }] };
    else if (route === '/api/config') body = { allow: { private: ['123'] }, tools: {}, persona: { roleText: 'fixture-role' } };
    else if (route === '/api/chats') body = { chats: [{ key: 'private:123', unread: overrides.unread || 0, lastTs: changed ? time : time - 120000 }] };
    else if (route.endsWith('/messages')) body = { messages: [] };
    else if (route === '/v1/mode-state') body = { ok: true, data: { protocol: 'pair', roomId: 'room', songId: '1001', playStatus: 'PLAY', playMode: 'ORDER_LOOP', membersCount: 2,
      sampledAt: time, modeManualHoldUntil: overrides.hold ? time + 3600000 : 0, modeQuota: { attemptsHour: 0, maxPerHour: 3, nextAt: 0 }, onebotLink: { verified: true, botId: '777', chatKey: 'private:123' } } };
    else if (route === '/v1/auto-mode') body = { ok: true, data: { confirmed: true, requested: true, playMode: 'RANDOM' } };
    else throw new Error('Unexpected route ' + route);
    return { ok: true, json: async () => body };
  };
  return { actor, calls, c, advance: n => { time += n; }, generated: () => generated,
    create: file => createModeRuntime({ config: () => c, request, active: () => true, stopped: () => false, now: () => time,
      stateFile: file, initialDelayMs: overrides.immediate ? 0 : 600000,
      generate: async () => { generated++; if (overrides.changed) changed = true; return { mode: overrides.decision || 'random' }; } }) };
}
for (const scenario of [ {}, { hold: true }, { unread: 1 }, { changed: true }, { decision: 'keep' }, { decision: 'invented' } ]) {
  test('independent background decision gates ' + JSON.stringify(scenario), async () => {
    const root = path.resolve(import.meta.dirname, '../../.test-state/modes');
    await fs.mkdir(root, { recursive: true });
    const folder = await fs.mkdtemp(path.join(root, 'qqa-mode-'));
    const f = runtimeSample(scenario), runtime = f.create(path.join(folder, 'state.json'));
    assert.equal((await runtime.tick(f.actor)).result, 'waiting'); assert.equal(f.generated(), 0);
    f.advance(600000); const result = await runtime.tick(f.actor);
    const shouldWrite = Object.keys(scenario).length === 0;
    assert.equal(f.calls.includes('/v1/auto-mode'), shouldWrite);
    assert.equal(result.result, shouldWrite ? 'confirmed' : scenario.hold ? 'room_or_policy_gate' : scenario.unread ? 'not_eligible' : scenario.changed ? 'context_changed' : scenario.decision === 'keep' ? 'keep' : 'invalid_decision');
    await runtime.tick(f.actor); assert.equal(f.generated(), scenario.hold || scenario.unread ? 0 : 1);
    runtime.close(); // Test state is retained in the temporary directory.
  });
}
test('tool routing cannot claim a proactive action as manual', async () => {
  const definitions = new Map(), calls = [], c = { bridgeUrl: 'http://127.0.0.1:32630', bridgeToken: 'fixture', allowedChats: 'private:123', autonomousMusic: true };
  setupFixture({ config: () => c, isSkillActive: () => true, registerTool: t => definitions.set(t.id, t), fetch: async (url, opts) => {
    calls.push({ route: new URL(url).pathname, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ ok: true, data: { confirmed: true } }) };
  } });
  const ctx = { chatKey: 'private:123', onebot: { connected: true, selfId: '777' }, proactive: true };
  await definitions.get('play_mode').execute(ctx, { mode: 'single', requested: true });
  assert.equal(calls.at(-1).route, '/v1/auto-mode');
  await definitions.get('play_mode').execute({ ...ctx, proactive: false }, { mode: 'list', requested: true });
  assert.equal(calls.at(-1).route, '/v1/mode');
  assert.equal(definitions.size, 14);
  skill.activate(); assert.equal(skill.playModeStatus().scheduled, true); skill.dispose(); assert.equal(skill.playModeStatus().stopped, true);
});
test('real bridge mode routes enforce automatic policy and ignore forged automatic=false', async t => {
  const f = sample(), server = bridgeServer({ together: f.together, token: 'fixture', schedule: false,
    authorize: async () => ({ botId: '777', allowedChats: ['private:123'], playModePolicy: policy }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const call = async (route, args) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/${route}`, { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
      body: JSON.stringify({ chatKey: 'private:123', botId: '777', ...args }) });
    return r.json();
  };
  assert.equal((await call('mode-state', {})).data.playMode, 'ORDER_LOOP');
  assert.equal((await call('auto-mode', { mode: 'single', automatic: false })).data.confirmed, true);
  assert.equal(f.together.modeState.bots['777'].attempts.length, 1);
  assert.equal((await call('auto-mode', { mode: 'random', automatic: false })).code, 'mode_rate_limited');
  assert.equal((await call('mode', { mode: 'list' })).data.confirmed, true);
  assert.equal(f.together.modeState.bots['777'].attempts.length, 1);
  assert.equal((await call('auto-mode', { mode: 'random' })).code, 'manual_mode_hold');
});
test('bridge rechecks global permissions, unread messages and pause before autonomous writes', async () => {
  const settings = { allow: { private: ['123'] }, tools: {} }, chat = { key: 'private:123', unread: 0 };
  const online = { onebot: { connected: true, self: { userId: '777' } }, orchestrator: { running: [] } };
  const authorize = createOneBotAuthorizer({ request: async url => ({ ok: true, json: async () => {
    const route = new URL(url).pathname;
    if (route === '/api/status') return online;
    if (route === '/api/skills') return { skills: [{ id: 'netease-listen-together', enabled: true, active: true,
      settings: { allowedChats: 'private:123', autonomousMusic: true, autonomousPlayModes: true } }] };
    if (route === '/api/config') return settings;
    if (route === '/api/chats') return { chats: [chat] };
    throw new Error('Unexpected path');
  } }) });
  const actor = { botId: '777', chatKey: 'private:123', action: 'auto-mode' };
  assert.equal((await authorize(actor)).playModePolicy.maxPerHour, 3);
  chat.unread = 1; await assert.rejects(authorize(actor), { code: 'autonomous_mode_disabled' });
  chat.unread = 0; settings.tools.enabled = false; await assert.rejects(authorize(actor), { code: 'autonomous_mode_disabled' });
  settings.tools.enabled = true; online.paused = true; await assert.rejects(authorize(actor), { code: 'autonomous_mode_disabled' });
});
