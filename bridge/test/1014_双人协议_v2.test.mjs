import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvite, resolveInvite, safeId, PAIR, NcmClient } from '../src/ncm.mjs';
import { Together } from '../src/together.mjs';
import { fixture, invite } from './fixtures.mjs';

test('只接受官方双人邀请，拒绝不支持的链接类型和伪造域名', () => {
  assert.equal(parseInvite(`一起听 ${invite}`).inviterId, '999');
  const indexInvite = invite.replace('/share/?', '/share/index.html?');
  assert.equal(parseInvite(`[邀请](${indexInvite})`).roomId, 'room-one');
  for (const bad of [invite.replace('st.music.163.com', 'evil.invalid'), invite.replace('/share/', '/multishare/index.html'), invite.replace('inviterId=999', 'inviterUid=999')]) assert.throws(() => parseInvite(bad));
  assert.throws(() => safeId(9007199254740992));
});

test('官方短链接可展开，跳转不会携带账号凭据或访问外部站点', async () => {
  let calls = 0;
  const target = await resolveInvite('https://163cn.tv/test', async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual'); assert.equal(options.headers, undefined);
    return new Response(null, { status: 302, headers: { location: invite } });
  });
  assert.equal(target.roomId, 'room-one'); assert.equal(calls, 1);
  await assert.rejects(resolveInvite('https://163cn.tv/test', async () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/test' } })));
});

test('两个不同账号加入双人房间，按状态核实结果再发心跳', async () => {
  const { state, together } = fixture();
  const view = await together.enter('private:123', { invite });
  assert.equal(view.protocol, 'pair'); assert.equal(view.songId, '1001'); assert.equal(state.saved.protocol, 'pair');
  const join = state.calls.find(x => x.uri === PAIR.join);
  assert.deepEqual(join.data, { roomId: 'room-one', inviterId: '999', refer: 'inbox_invite' });
  const beat = state.calls.find(x => x.uri === PAIR.heartbeat);
  assert.deepEqual(beat.data, { roomId: 'room-one', songId: '1001', progress: 35000, playStatus: 'PLAY' });
  assert.equal(state.calls.every(x => Object.values(PAIR).includes(x.uri)), true);
});

test('拒绝本人账号，不向服务端发入房操作', async () => {
  const { state, together } = fixture(); state.uid = '999';
  await assert.rejects(together.enter('private:123', { invite }), { code: 'same_account' });
  assert.equal(state.calls.length, 0);
});

test('即使没有本人标记，也拒绝账号邀请自己', async () => {
  const { state, client } = fixture(); state.uid = '999';
  const together = new Together(client);
  await assert.rejects(together.enter('private:123', { invite }), { code: 'same_account' });
  assert.equal(state.calls.length, 0);
});

test('双人房间已满或不可加入时拒绝入房', async () => {
  const { state, together } = fixture(); state.full = true;
  await assert.rejects(together.enter('private:123', { invite }), { code: 'room_not_joinable' });
  assert.equal(state.calls.some(x => x.uri === PAIR.join), false);
});

test('HTTP 200 但入房被拒绝或未核实，不报告成功', async () => {
  const f = fixture(); f.state.rejectEnter = true;
  await assert.rejects(f.together.enter('private:123', { invite }), { code: 'business_rejected' });
  assert.equal(f.together.room, null);
  const g = fixture(); g.state.unknownJoin = true;
  await assert.rejects(g.together.enter('private:123', { invite })); assert.equal(g.together.room, null);
});

test('创建双人房间，写共享列表和 GOTO，不发邀请消息', async () => {
  const { state, together } = fixture(); await together.enter('private:123', { songId: '1002' });
  assert.deepEqual(state.calls.find(x => x.uri === PAIR.create).data, { refer: 'songplay_more' });
  const command = JSON.parse(state.calls.find(x => x.uri === PAIR.command).data.commandInfo);
  assert.equal(command.commandType, 'GOTO'); assert.equal(command.targetSongId, '1002');
  assert.match(together.view().shareUrl, /\/share\//);
});

test('无法完整播放的歌不能用于开房', async () => {
  const { state, together } = fixture(); state.trial = true;
  await assert.rejects(together.enter('private:123', { songId: '1001' }), { code: 'not_playable' });
  assert.equal(state.calls.some(x => x.uri === PAIR.create), false);
});

test('远端切歌后讨论使用新歌曲，不使用邀请里的旧歌', async () => {
  const { state, together } = fixture(); await together.enter('private:123', { invite });
  state.songId = '2002'; const context = await together.context('private:123');
  assert.equal(context.song.id, '2002'); assert.equal(context.song.album, '测试专辑');
  assert.equal(context.progressMs, 35000); assert.equal(context.lyrics.length, 3);
});

test('服务端播放字段缺失时报告未知，不发送猜测心跳', async () => {
  const { state, together } = fixture(); state.unknownPlay = true;
  const view = await together.enter('private:123', { invite });
  assert.equal(view.songId, null); assert.equal(view.sync, 'playback_unknown');
  assert.equal(state.calls.some(x => x.uri === PAIR.heartbeat), false);
  assert.equal((await together.context('private:123')).song, null);
  await assert.rejects(together.next('private:123'));
});

test('真实双人响应 playCommand 可识别歌曲，明确标记最后命令进度', () => {
  const { together } = fixture();
  const play = together.readPlay({ playCommand: { targetSongId: '21274655', progress: 1635, playStatus: 'PAUSE', serverSeq: 8 } });
  assert.equal(play.songId, '21274655'); assert.equal(play.progress, 1635);
  assert.equal(play.progressSource, 'last-server-command');
  together.play = play;
  assert.match(together.view().progressNote, /不能视为当前精确秒数/);
});

test('添加共享列表保留原歌曲，并回读核实；切歌用 GOTO', async () => {
  const { state, together } = fixture(); await together.enter('private:123', { invite });
  await together.push('private:123', '2002');
  assert.deepEqual(state.queue, ['1001', '1002', '2002']); assert.equal(state.songId, '1001');
  const next = await together.next('private:123'); assert.equal(next.confirmed, true); assert.equal(state.songId, '1002');
});

test('双人暂停继续会发送共享播放命令并核实状态', async () => {
  const { state, together } = fixture(); await together.enter('private:123', { invite });
  assert.equal((await together.control('private:123', 'pause')).confirmed, true); assert.equal(state.playStatus, 'PAUSE');
  assert.equal((await together.control('private:123', 'resume')).confirmed, true); assert.equal(state.playStatus, 'PLAY');
  await assert.rejects(together.control('private:123', 'other'));
});

test('指令延迟生效时不冒充切歌完成，业务拒绝不自动重试', async () => {
  const { state, together } = fixture(); await together.enter('private:123', { invite });
  state.delayedWrite = true; assert.equal((await together.next('private:123')).confirmed, false);
  await assert.rejects(together.push('private:123', '2002'));
  state.rejectWrite = true; await assert.rejects(together.control('private:123', 'pause'), { code: 'business_rejected' });
});

test('防止跨 QQ 会话接管房间、同账号已有其他房间和旧绑定恢复', async () => {
  const { state, client, together } = fixture(); state.inRoom = true;
  await assert.rejects(together.enter('private:123', { songId: '1001' }));
  assert.equal(state.calls.some(x => x.uri === PAIR.create || x.uri === PAIR.end), false);
  await together.enter('private:123', { invite });
  await assert.rejects(together.context('group:456'), { code: 'room_owned_elsewhere' });
  assert.equal(new Together(client, { saved: { id: 'old', protocol: 'obsolete' } }).room, null);
});

test('重启后核实房间，账号变化和远端退出时不沿用旧状态', async () => {
  const { state, client, together } = fixture(); await together.enter('private:123', { invite });
  const restarted = new Together(client, { saved: state.saved, ownerUid: '999' });
  assert.equal((await restarted.refresh('private:123')).songId, '1001');
  state.uid = '456'; await assert.rejects(restarted.refresh('private:123'), { code: 'account_changed' });
  assert.equal(restarted.room, null);
  state.uid = '123'; state.inRoom = false;
  await assert.rejects(together.refresh('private:123'), { code: 'room_changed' });
});

test('结束双人房间必须明确确认成功，清除绑定；串行失败不阻断后续', async () => {
  const { state, together } = fixture(); await together.enter('private:123', { invite });
  state.rejectWrite = true; await assert.rejects(together.leave('private:123'), { code: 'business_rejected' });
  assert.notEqual(together.room, null); state.rejectWrite = false;
  const first = together.run(async () => { throw new Error('fixture'); });
  const second = together.run(() => together.leave('private:123'));
  await assert.rejects(first); assert.equal((await second).ended, true); assert.equal(state.saved, null);
});

test('嵌套登录状态、登录失效与错误脱敏', async () => {
  const { client } = fixture(); assert.equal((await client.account()).uid, '123');
  const expired = new NcmClient('', { login_status: async () => ({ body: { data: { code: 302 } } }) });
  await assert.rejects(expired.account(), { code: 'login_required' });
  const failed = new NcmClient('', { login_status: async () => { throw new Error('MUSIC_U=SECRET'); } });
  await assert.rejects(failed.account(), error => !error.message.includes('SECRET'));
  await assert.rejects(client.pair('arbitrary'));
});
