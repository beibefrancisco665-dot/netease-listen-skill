import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, invite } from './fixtures.mjs';
import { PAIR } from '../src/ncm.mjs';
import { setup as skillSetup, hooks, promptSections } from '../../skills/netease-listen-together/index.js';
function setup(api){return skillSetup({...api,capability:(_name,{url,init})=>api.fetch(url,init)});}

test('复现 xeapi 密钥链路失败；官方 eapi 预检后选歌加歌和 GOTO 正常', async () => {
  const f = fixture(); f.state.requireEapi = true;
  await assert.rejects(f.client.call('song_url_v1', { id: '2002', level: 'standard' }), { code: 'upstream_unavailable' });
  await f.together.enter('private:123', { invite });
  const selected = await f.together.choose('private:123', { songId: '2002' });
  assert.equal(selected.confirmed, true); assert.equal(f.state.songId, '2002');
  assert.deepEqual(f.state.queue, ['1001', '1002', '2002']);
  assert.deepEqual(f.state.streamCalls.at(-1), { id: '2002', level: 'standard', crypto: 'eapi' });
  assert.equal(JSON.parse(f.state.calls.find(call => call.uri === PAIR.command).data.commandInfo).commandType, 'GOTO');
});

test('按歌名选歌使用权限预检并回读；请求参数不能注入协议或账号', async () => {
  const f = fixture(); await f.together.enter('private:123', { invite });
  f.state.songId = '1002';
  const result = await f.together.choose('private:123', { query: '测试歌', crypto: 'xeapi', uid: '999' });
  assert.equal(result.songId, '1001'); assert.equal(result.confirmed, true);
  assert.equal(f.state.streamCalls.at(-1).crypto, 'eapi');
});

test('next 也检查账号播放权限；不可完整播放时不发送切歌命令', async () => {
  const f = fixture(); await f.together.enter('private:123', { invite });
  f.state.unplayable = '1002';
  await assert.rejects(f.together.next('private:123'), { code: 'not_playable' });
  assert.equal(f.state.calls.some(call => call.uri === PAIR.command), false);
  f.state.unplayable = null;
  assert.equal((await f.together.next('private:123')).confirmed, true);
});

test('读取预检失败明确表示未发送切歌；不能把它当作写入结果未知', async () => {
  const f = fixture(); await f.together.enter('private:123', { invite });
  f.state.streamDown = true;
  await assert.rejects(f.together.choose('private:123', { songId: '2002' }), error => error.code === 'playability_check_failed' && /尚未发送/.test(error.message));
  assert.equal(f.state.calls.some(call => [PAIR.command, PAIR.sync].includes(call.uri)), false);
});

test('选取已播放的同一首歌保持进度，不重复发命令；无其它歌给出 choose 指引', async () => {
  const f = fixture(); await f.together.enter('private:123', { invite });
  f.state.streamDown = true;
  const result = await f.together.choose('private:123', { songId: '1001' });
  assert.equal(result.alreadyPlaying, true); assert.equal(f.state.progress, 35000);
  assert.equal(f.state.streamCalls.length, 0);
  assert.equal(f.state.calls.some(call => call.uri === PAIR.command), false);
  f.state.queue = ['1001'];
  assert.equal((await f.together.refresh('private:123')).canSkip, false);
  await assert.rejects(f.together.next('private:123'), error => error.code === 'no_next_song' && /choose/.test(error.message));
});

test('重复歌曲 ID 不会让下一首切回当前歌；延迟响应不能冒充成功', async () => {
  const f = fixture(); await f.together.enter('private:123', { invite });
  f.state.queue = ['1001', '1001', '1002'];
  assert.equal((await f.together.next('private:123')).songId, '1002');
  f.state.delayedWrite = true;
  assert.equal((await f.together.next('private:123')).confirmed, false);
});

test('实际宿主 proactive/sessionId 载荷控制自主切歌；显式用户会话保持可用', async () => {
  const tools = new Map(); let requests = 0;
  const config = { bridgeUrl: 'http://127.0.0.1:32630', bridgeToken: 'fixture', allowedChats: 'private:123', autonomousMusic: false };
  setup({ config: () => config, fetch: async () => { requests++; return Response.json({ ok: true, data: { confirmed: true } }); }, registerTool: tool => tools.set(tool.id, tool) });
  hooks['before-llm-messages']({ chatKey: 'private:123', sessionId: 'proactive-session', proactive: true });
  const actor = id => ({ chatKey: 'private:123', onebot: { connected: true, selfId: '777' }, session: { id } });
  assert.equal((await tools.get('next').execute(actor('proactive-session'))).isError, true);
  assert.equal(requests, 0);
  assert.equal((await tools.get('favorites').execute(actor('proactive-session'))).isError, undefined);
  assert.equal((await tools.get('next').execute(actor('explicit-user'))).isError, undefined);
  assert.equal(hooks['before-tool']({ chatKey: 'private:123', sessionId: 'p2', proactive: true, toolName: 'netease-listen-together__choose' }).block, true);
  assert.equal(hooks['before-tool']({ chatKey: 'private:123', proactive: true, toolName: 'other-plugin__next' }), undefined);
  config.autonomousMusic = true;
  assert.equal((await tools.get('choose').execute(actor('proactive-session'), { songId: '1002' })).isError, undefined);
  assert.match(promptSections({ chatKey: 'private:123' }).find(section => section.id === 'netease-music-permission').content, /不需要每次再请示/);
  config.autonomousMusic = false;
  assert.match(promptSections({ chatKey: 'private:123' }).find(section => section.id === 'netease-music-permission').content, /自主音乐操作已关闭/);
  assert.deepEqual(promptSections({ chatKey: 'private:999' }), []);
});
