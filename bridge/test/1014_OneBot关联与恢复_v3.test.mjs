import test from 'node:test';
import assert from 'node:assert/strict';
import { createOneBotAuthorizer } from '../src/onebot-link.mjs';
import { PAIR } from '../src/ncm.mjs';
import { fixture, invite } from './fixtures.mjs';

test('真实 OneBot 身份、允许发起者和第二个音乐账号形成关联；离线和伪造身份拒绝', async () => {
  let connected = true, saved;
  const authorize = createOneBotAuthorizer({ musicUid: '123', save: async link => { saved = link; }, request: async url => {
    const body = url.endsWith('/api/status') ? { onebot: { connected, self: { userId: '777' } } }
      : { skills: [{ id: 'netease-listen-together', enabled: true, active: true, settings: { allowedChats: 'private:123, private:777' } }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const actor = await authorize({ botId: '777', chatKey: 'private:123' });
  assert.equal(actor.botId, '777'); assert.equal(saved.musicUid, '123'); assert.equal(saved.chatKey, 'private:123');
  await assert.rejects(authorize({ botId: 'other', chatKey: 'private:123' }), { code: 'onebot_mismatch' });
  await assert.rejects(authorize({ botId: '777', chatKey: 'private:999' }), { code: 'chat_not_allowed' });
  await assert.rejects(authorize({ botId: '777', chatKey: 'private:777' }), { code: 'bot_self_chat' });
  connected = false;
  await assert.rejects(authorize({ botId: '777', chatKey: 'private:123' }), { code: 'onebot_offline' });
});

test('错误绑定机器人自身私聊时，同一实际房间可迁移到允许发起人，不退出不重入', async () => {
  const { together, state } = fixture();
  await together.enter('private:777', { invite });
  together.connect({ botId: '777', allowedChats: ['private:123'] });
  const callCount = state.calls.filter(x => x.uri === PAIR.join).length;
  const current = await together.enter('private:123', { invite });
  assert.equal(state.saved.chatKey, 'private:123'); assert.equal(state.saved.botId, '777');
  assert.equal(current.onebotLink.verified, true);
  assert.equal(state.calls.filter(x => x.uri === PAIR.join).length, callCount);
  assert.equal(state.calls.some(x => x.uri === PAIR.end), false);
});

test('旧房间已远端退出时，换 QQ 会话也会先清理失效绑定再加入', async () => {
  const { together, state } = fixture(); await together.enter('private:456', { invite });
  state.inRoom = false;
  together.connect({ botId: '777', allowedChats: ['private:123'] });
  await together.enter('private:123', { invite });
  assert.equal(state.saved.chatKey, 'private:123'); assert.equal(state.inRoom, true);
});

test('仍有效且允许的其他会话不被暗中接管，但授权的结束不再被旧绑定锁死', async () => {
  const { together, state } = fixture(); await together.enter('private:456', { invite });
  together.connect({ botId: '777', allowedChats: ['private:123', 'private:456'] });
  await assert.rejects(together.enter('private:123', { invite }), { code: 'room_owned_elsewhere' });
  const result = await together.leave('private:123');
  assert.equal(result.ended, true); assert.equal(state.saved, null);
});

test('结束流程不依赖歌单或心跳；远端已退出则只清理残留，不发送结束请求', async () => {
  const { together, state, client } = fixture(); await together.enter('private:456', { invite });
  together.connect({ botId: '777', allowedChats: ['private:123'] });
  const original = client.pair.bind(client);
  client.pair = async (action, data) => {
    if (['playlist', 'heartbeat'].includes(action)) throw new Error('fixture unavailable');
    return original(action, data);
  };
  assert.equal((await together.leave('private:123')).ended, true);
  assert.equal((await together.leave('private:123')).alreadyLeft, true);
  assert.equal(state.calls.filter(x => x.uri === PAIR.end).length, 1);
});

test('已关联不同 OneBot 的房间拒绝接管和结束', async () => {
  const { together } = fixture(); together.connect({ botId: '777', allowedChats: ['private:123'] });
  await together.enter('private:123', { invite });
  together.connect({ botId: '888', allowedChats: ['private:123'] });
  await assert.rejects(together.enter('private:123', { invite }), { code: 'onebot_mismatch' });
  await assert.rejects(together.leave('private:123'), { code: 'onebot_mismatch' });
});
