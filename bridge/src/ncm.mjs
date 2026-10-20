import { Sdk } from './sdk.mjs';

export const PAIR = Object.freeze({
  check: '/api/listen/together/room/check',
  create: '/api/listen/together/room/create',
  join: '/api/listen/together/play/invitation/accept',
  status: '/api/listen/together/status/get',
  heartbeat: '/api/listen/together/heartbeat',
  playlist: '/api/listen/together/sync/playlist/get',
  sync: '/api/listen/together/sync/list/command/report',
  command: '/api/listen/together/play/command/report',
  end: '/api/listen/together/end/v2'
});

export class UserError extends Error {
  constructor(message, code = 'operation_failed') { super(message); this.code = code; }
}

export function safeId(value, label = '编号', pattern = /^[1-9]\d{0,19}$/) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new UserError(`${label}精度丢失，请使用原始字符串编号。`);
  const id = String(value ?? '').trim();
  if (!pattern.test(id)) throw new UserError(`${label}格式无效。`);
  return id;
}

export const roomId = value => safeId(value, '房间 ID', /^[A-Za-z0-9_-]{1,160}$/);

export function parseInvite(value) {
  const input = String(value ?? '').trim();
  const match = input.match(/https?:\/\/st\.music\.163\.com\/listen-together\/share\/(?:index\.html)?\?[^\s<>"，。)\]]+/i);
  let url;
  try { url = new URL(match ? match[0] : input); } catch { throw new UserError('请粘贴网易云双人一起听邀请链接。'); }
  if (url.hostname !== 'st.music.163.com' || !['/listen-together/share/', '/listen-together/share/index.html'].includes(url.pathname)
      || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new UserError('只支持网易云双人一起听 share 邀请；该链接类型不支持。');
  }
  if (!['false', '0', null].includes(url.searchParams.get('isFLT'))) throw new UserError('该链接是“跟听”，不属于多人一起听。');
  return { roomId: roomId(url.searchParams.get('roomId')), inviterId: safeId(url.searchParams.get('inviterId'), '邀请者 UID'), songId: url.searchParams.get('songId') ? safeId(url.searchParams.get('songId'), '分享歌曲 ID') : null };
}

export function shareLink(id, uid, songId) {
  const query = new URLSearchParams({ roomId: roomId(id), inviterId: safeId(uid), ...(songId ? { songId: safeId(songId) } : {}) });
  return `https://st.music.163.com/listen-together/share/?${query}`;
}

export async function resolveInvite(value, request = fetch) {
  let current = String(value ?? '').trim();
  if (!current.startsWith('https://163cn.tv/')) return parseInvite(current);
  for (let step = 0; step < 4; step++) {
    const url = new URL(current);
    if (url.protocol !== 'https:' || url.hostname !== '163cn.tv' || url.port || url.username || url.password) throw new UserError('短链接跳转地址不可信。');
    let response;
    try { response = await request(url.href, { redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
    catch { throw new UserError('网易云短链接暂时无法展开，请提供客户端中的完整邀请。'); }
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new UserError('短链接没有返回有效邀请跳转。');
    current = new URL(location, url).href;
    if (new URL(current).hostname === 'st.music.163.com') return parseInvite(current);
  }
  throw new UserError('短链接跳转次数过多。');
}

export class NcmClient {
  constructor(cookie = '', sdk = null) {
    this.cookie = cookie;
    this.sdk = sdk || new Sdk();
  }
  async call(name, args = {}, { qr = false } = {}) {
    if (!this.sdk.invoke && typeof this.sdk[name] !== 'function') throw new UserError('网易云接口模块缺失，请按锁文件安装依赖。');
    let response;
    try {
      const input = { ...args, cookie: this.cookie, timeout: 12000, timestamp: Date.now() };
      response = this.sdk.invoke ? await this.sdk.invoke(name, input) : await this.sdk[name](input);
    } catch (error) {
      // Never propagate raw SDK errors: they may contain cookies, signed URLs or request headers.
      const code = error?.body?.code ?? error?.response?.data?.code;
      if ([301, 302, 401].includes(Number(code))) throw new UserError('网易云登录已失效，请重新扫码。', 'login_required');
      const writes = name === 'like' || (name === 'api' && [PAIR.create, PAIR.join, PAIR.sync, PAIR.command, PAIR.end].includes(args.uri));
      throw new UserError(writes ? '网易云写入请求失败或超时；结果可能未知，请先读取 state，不自动重复写入。' : '网易云读取请求失败或超时；本步骤未发送切歌或歌单修改命令。', 'upstream_unavailable');
    }
    const body = response?.body;
    if (!body || typeof body !== 'object') throw new UserError('网易云返回格式不符合预期。', 'invalid_response');
    // login_status wraps its upstream response in data, including the status code.
    const code = Number(body.code ?? (name === 'login_status' ? body.data?.code : undefined));
    if (qr && [800, 801, 802, 803].includes(code)) return body;
    if ([301, 302, 401].includes(code)) throw new UserError('网易云登录已失效，请重新扫码。', 'login_required');
    if (code === 488) throw new UserError('一起听房间已失效，请重新加入。', 'room_expired');
    if (code !== 200) throw new UserError(`网易云拒绝请求（code=${Number.isFinite(code) ? code : 'unknown'}），请检查账号权限或稍后再试。`, 'upstream_rejected');
    return body;
  }
  close() { return this.sdk.close?.(); }
  async pair(action, data = {}) {
    if (!Object.hasOwn(PAIR, action)) throw new UserError('未允许的网易云双人接口。');
    const body = await this.call('api', { uri: PAIR[action], data, crypto: action === 'status' ? 'weapi' : 'eapi' });
    if (body.data?.success === false) {
      throw new UserError('网易云没有确认房间操作成功；账号资格、邀请有效性或服务端限制可能不满足。', 'business_rejected');
    }
    if (action === 'end' && body.data?.success !== true) throw new UserError('网易云没有确认结束成功，请先刷新房间。', 'business_rejected');
    return body.data;
  }
  async account() {
    const body = await this.call('login_status');
    const profile = body.data?.profile;
    if (!profile?.userId) throw new UserError('请先在本机执行扫码登录。', 'login_required');
    return { uid: safeId(profile.userId, '账号 UID'), nickname: String(profile.nickname ?? '') };
  }
  async song(id) {
    const body = await this.call('song_detail', { ids: safeId(id, '歌曲 ID') });
    const item = body.songs?.find(s => String(s.id) === String(id));
    if (!item) throw new UserError('网易云未返回该歌曲的资料。');
    return {
      id: safeId(item.id), title: String(item.name ?? ''),
      artists: (item.ar || item.artists || []).map(x => String(x.name ?? '')).join('、'),
      album: String(item.al?.name || item.album?.name || ''), durationMs: Number(item.dt || item.duration || 0)
    };
  }
  async search(query, limit = 5) {
    const keywords = String(query ?? '').trim();
    if (!keywords || keywords.length > 200) throw new UserError('搜索词需要 1～200 个字符。');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new UserError('搜索数量需要是 1～10 的整数。');
    const body = await this.call('cloudsearch', { keywords, type: 1, limit });
    return (body.result?.songs || []).map(s => ({
      id: safeId(s.id), title: String(s.name ?? ''),
      artists: (s.ar || s.artists || []).map(x => String(x.name ?? '')).join('、'), album: String(s.al?.name || s.album?.name || '')
    }));
  }
  async fullStream(id) {
    // The pinned SDK defaults to xeapi, whose separate public-key registration may fail.
    // Use the supported official eapi transport; playback rights are still verified below.
    let body;
    try { body = await this.call('song_url_v1', { id: safeId(id), level: 'standard', crypto: 'eapi' }); }
    catch (error) {
      if (error.code !== 'upstream_unavailable') throw error;
      throw new UserError('歌曲播放权限查询失败，尚未发送切歌或歌单修改命令；请稍后查询，勿连续重试。', 'playability_check_failed');
    }
    const stream = body.data?.find(s => String(s.id) === String(id));
    if (!stream?.url || stream.freeTrialInfo || stream.flag === 1 || Number(stream.code) !== 200) {
      throw new UserError('当前账号无法完整播放这首歌，请选择有播放权限的歌曲。', 'not_playable');
    }
    return stream.url;
  }
  async liked(uid) {
    const body = await this.call('likelist', { uid: safeId(uid, '网易云 UID') });
    if (!Array.isArray(body.ids)) throw new UserError('未取得可核实的喜欢歌曲列表。', 'invalid_response');
    return body.ids.map(id => safeId(id, '收藏歌曲 ID'));
  }
  async like(id) {
    return this.call('like', { id: safeId(id, '歌曲 ID'), like: 'true' });
  }
}
