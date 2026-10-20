import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bridgeServer } from '../src/server.mjs';
import { setup, available, deactivate } from '../../skills/netease-listen-together/index.js';
import { Sdk } from '../src/sdk.mjs';
import { fixture, invite } from './fixtures.mjs';

test('本机桥接 + QQAgent 技能完整调用链，以及访问控制、参数绑定和停用', async t => {
  const { together } = fixture();
  const server = bridgeServer({ together, token: 'fixture-bridge-token', schedule: false, authorize: async input => {
    if (!['private:123', 'group:456'].includes(input.chatKey) || input.botId !== '777') throw new Error('fixture unauthorized');
    return { botId: '777', allowedChats: ['private:123', 'group:456'] };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const bridgeUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const definitions = new Map();
  const config = { bridgeUrl, bridgeToken: 'fixture-bridge-token', allowedChats: 'private:123, group:456' };
  setup({ config: () => config, fetch, capability: (_name, { url, init }) => fetch(url, init), registerTool: def => definitions.set(def.id, def) });
  const ctx = chatKey => ({ chatKey, selfId: '777', onebot: { connected: true, selfId: '777' } });
  assert.equal(definitions.size, 14); assert.deepEqual(available(), { ok: true });
  assert.equal((await definitions.get('join').execute({ chatKey: 'private:123' }, {})).isError, true);
  assert.equal((await definitions.get('search').execute({ chatKey: 'private:999' }, { query: '测试' })).isError, true);
  const search = await definitions.get('search').execute(ctx('private:123'), { query: '测试', chatKey: 'group:456', botId: 'injected' });
  assert.equal(search.isError, undefined); assert.match(search.content, /测试专辑/);
  const join = await definitions.get('join').execute(ctx('private:123'), { invite });
  assert.equal(join.isError, undefined); assert.equal(together.room.chatKey, 'private:123');
  assert.equal((await definitions.get('context').execute(ctx('group:456'))).isError, true);
  const context = await definitions.get('context').execute(ctx('private:123'));
  assert.equal(context.isError, undefined); assert.match(context.content, /测试歌词/);
  assert.equal(context.content.includes('MUSIC_U'), false);
  const choose = await definitions.get('choose').execute(ctx('private:123'), { songId: '1002' });
  assert.equal(choose.isError, undefined); assert.match(choose.content, /confirmed/);
  const liked = await definitions.get('like').execute(ctx('private:123'), { songId: '1001' });
  assert.equal(liked.isError, undefined); assert.match(liked.content, /机器人我喜欢的音乐/);
  const favorites = await definitions.get('favorites').execute(ctx('private:123'), { limit: 2 });
  assert.equal(favorites.isError, undefined); assert.match(favorites.content, /total/);
  const proactive = { ...ctx('private:123'), session: { proactive: true } };
  config.autonomousMusic = false;
  assert.equal((await definitions.get('choose').execute(proactive, { songId: '1001' })).isError, true);
  config.autonomousMusic = true;
  assert.equal((await fetch(`${bridgeUrl}/v1/state`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${bridgeUrl}/health`, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    http.get(`${bridgeUrl}/health`, { headers: { host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(invalidHost, 403);
  assert.equal((await fetch(`${bridgeUrl}/health`)).status, 200);
  config.bridgeUrl = 'http://example.invalid:3000';
  assert.equal(available().ok, false);
  config.bridgeUrl = bridgeUrl;
  config.allowedChatKeys = 'private:123';
  config.allowedChats = '';
  assert.equal(available().ok, false);
  assert.equal((await definitions.get('search').execute({ chatKey: 'private:123' }, { query: '测试' })).isError, true);
  config.allowedChats = 'private:123';
  assert.equal(available().ok, true);
  config.allowedChats = 'private:invalid';
  assert.equal(available().ok, false);
  config.allowedChats = 'private:123';
  await deactivate();
  const leave = await definitions.get('leave').execute(ctx('private:123'));
  assert.equal(leave.isError, undefined); assert.equal(together.room, null);
  assert.match(leave.content, /双人一起听已结束/);
});

test('固定 SDK 真实模块能在隔离工作线程初始化，不调用真实网易云接口', async () => {
  const sdk = new Sdk();
  try { await sdk.ready; } finally { await sdk.close(); }
});
