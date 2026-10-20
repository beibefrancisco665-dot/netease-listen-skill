import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { NcmClient, UserError } from './ncm.mjs';
import { Together } from './together.mjs';
import { createOneBotAuthorizer } from './onebot-link.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME = path.join(ROOT, 'runtime');

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new UserError('本地配置损坏，请检查 runtime 内的配置文件。'); }
}

export async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function connectionInfo() {
  const file = path.join(RUNTIME, '1014_连接配置_v1.json');
  const current = await readJson(file, null);
  if (current?.bridgeToken && current?.bridgeUrl) return current;
  const info = { bridgeUrl: 'http://127.0.0.1:32630', bridgeToken: randomBytes(32).toString('hex') };
  await writeJson(file, info); return info;
}

function authorized(request, token) {
  const actual = Buffer.from(request.headers.authorization || '');
  const wanted = Buffer.from(`Bearer ${token}`);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function body(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new UserError('请求必须是 JSON。');
  let size = 0, chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new UserError('请求内容过长。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new UserError('请求 JSON 无效。'); }
}

export function bridgeServer({ together, token, schedule = true, port = 32630, authorize = createOneBotAuthorizer() }) {
  let timer = null, closed = false, suspended = false;
  const routes = Object.freeze({
    search: (chatKey, args) => { together.assertOwner(chatKey); return together.client.search(args.query, args.limit ?? 5); },
    create: (chatKey, args) => together.enter(chatKey, { songId: args.songId }),
    join: (chatKey, args) => together.enter(chatKey, { invite: args.invite }),
    state: chatKey => together.refresh(chatKey),
    'invitation-status': chatKey => together.invitationStatus(chatKey),
    watch: chatKey => together.watchState(chatKey),
    'mode-state': (chatKey, args, actor) => together.modeStateFor(chatKey, actor.playModePolicy),
    mode: (chatKey, args, actor) => together.setPlayMode(chatKey, { ...args, automatic: false }, actor.playModePolicy),
    'auto-mode': (chatKey, args, actor) => together.setPlayMode(chatKey, { ...args, automatic: true }, actor.playModePolicy),
    context: chatKey => together.context(chatKey),
    push: (chatKey, args) => together.push(chatKey, args.songId),
    choose: (chatKey, args) => together.choose(chatKey, args),
    like: (chatKey, args) => together.like(chatKey, args.songId),
    favorites: (chatKey, args) => together.favorites(chatKey, args.limit ?? 10),
    preference: (chatKey, args) => together.preference(chatKey, args.songId),
    'auto-like': (chatKey, args, actor) => together.autoLike(chatKey, args.songId, actor.autoLikePolicy),
    'auto-like-search': (chatKey, args, actor) => together.autoLikeSearch(chatKey, args.songId, actor.autoLikePolicy),
    inspect: (chatKey, args) => together.inspectSong(chatKey, args.songId),
    next: chatKey => together.next(chatKey),
    control: (chatKey, args) => together.control(chatKey, args.action),
    leave: chatKey => together.leave(chatKey)
  });
  function poll() {
    clearTimeout(timer);
    if (!schedule || closed || suspended || !together.room) return;
    timer = setTimeout(async () => {
      try { await together.run(async () => {
        if (!together.room) return;
        const actor = await authorize({ chatKey: together.room.chatKey, botId: together.room.botId });
        together.connect(actor);
        await together.refresh(together.room.chatKey);
      }); }
      catch (error) { together.lastError = error instanceof UserError ? error.message : '房间同步暂时失败。'; }
      poll();
    }, together.lastError ? Math.max(together.intervalMs, 30000) : together.intervalMs);
    timer.unref();
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    const host = request.headers.host || '';
    if (host !== `127.0.0.1:${request.socket.localPort}`) { send(403, { ok: false, error: '拒绝不可信主机。' }); return; }
    if (request.headers.origin) { send(403, { ok: false, error: '该接口只供本机 QQAgent 调用。' }); return; }
    if (request.method === 'GET' && request.url === '/health') { send(200, { ok: true, service: 'qqa-netease-together', protocol: 'pair', hostDataDir: process.env.QQA_HOST_DATA_DIR || null }); return; }
    if (!authorized(request, token)) { send(401, { ok: false, error: '连接密钥不匹配，请检查 QQAgent 技能设置。' }); return; }
    if (request.method !== 'POST') { send(405, { ok: false, error: '只接受 POST。' }); return; }
    const action = request.url?.replace(/^\/v1\//, '');
    if (action === 'suspend') {
      suspended = true; clearTimeout(timer); send(200, { ok: true, data: { suspended: true } }); return;
    }
    if (!Object.hasOwn(routes, action)) { send(404, { ok: false, error: '不存在的操作。' }); return; }
    try {
      const input = await body(request);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UserError('请求必须是 JSON 对象。');
      const data = await together.run(async () => {
        const actor = await authorize({ ...input, action });
        together.connect(actor);
        return routes[action](input.chatKey, input, actor);
      });
      // Frequent cached reads must not reset the 10s NetEase poll or starve it forever.
      if (action !== 'watch' || suspended || !timer) { suspended = false; poll(); }
      send(200, { ok: true, data });
    } catch (error) {
      send(error instanceof UserError ? 400 : 500, {
        ok: false, code: error instanceof UserError ? error.code : 'internal_error',
        error: error instanceof UserError ? error.message : '本地桥接服务发生错误，请检查安装和配置。'
      });
    }
  });
  server.on('close', () => { closed = true; clearTimeout(timer); });
  server.once('listening', poll);
  return server;
}

async function main() {
  const credentials = await readJson(path.join(RUNTIME, '1014_qqa专用会话_v2.json'), null);
  if (!credentials?.cookie || credentials.role !== 'qqa') throw new UserError('请用第二个网易云账号执行 npm run login，本人账号旧会话不会用于桥接。');
  const personal = await readJson(path.join(RUNTIME, '1014_网易云会话_v1.json'), null);
  if (personal?.uid && String(credentials.uid) === String(personal.uid)) throw new UserError('qqa 账号与本人账号相同，拒绝启动。');
  const info = await connectionInfo();
  const parsed = new URL(info.bridgeUrl);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/' || !parsed.port) throw new UserError('连接地址必须是带端口的 http://127.0.0.1。');
  const stateFile = path.join(RUNTIME, '1014_房间绑定_v1.json');
  const saved = process.env.QQA_BRIDGE_NO_ROOM_RESTORE === '1' ? null : await readJson(stateFile, null);
  const modeFile = path.join(RUNTIME, '1016_播放模式状态_v1.json');
  let modeState;
  try {
    modeState = JSON.parse(await fs.readFile(modeFile, 'utf8'));
    if (modeState?.version !== 1 || !modeState.bots || typeof modeState.bots !== 'object' || Array.isArray(modeState.bots)) throw new Error('Invalid mode state');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new UserError('播放模式限频文件损坏；保留原文件，拒绝重置次数。');
    modeState = { version: 1, bots: {} };
  }
  const together = new Together(new NcmClient(credentials.cookie), { saved, modeState, saveModeState: data => writeJson(modeFile, data),
    ownerUid: personal?.uid || '', save: data => writeJson(stateFile, data) });
  const hostData = process.env.QQA_HOST_DATA_DIR;
  if (!hostData || !path.isAbsolute(hostData)) throw new UserError('请从当前QQA的网易云适配模块启动桥接。');
  const hostBase = async () => {
    const raw = String(await fs.readFile(path.join(hostData,'console-port'),'utf8')).trim(),port=Number(raw);
    if (!/^\d+$/.test(raw)||!Number.isInteger(port)||port<1024||port>65535) throw new UserError('当前QQA控制台端口尚未就绪。');
    const base='http://127.0.0.1:'+port,response=await fetch(base+'/api/status',{signal:AbortSignal.timeout(5000),redirect:'error'}),status=await response.json();
    if (!response.ok||path.resolve(status.dataDir||'').toLowerCase()!==path.resolve(hostData).toLowerCase()) throw new UserError('QQA控制台实例身份不匹配。');
    return base;
  };
  const authorize = createOneBotAuthorizer({ base:hostBase,musicUid: String(credentials.uid), save: link => writeJson(path.join(RUNTIME, '1014_OneBot网易云关联_v3.json'), link) });
  const server = bridgeServer({ together, token: info.bridgeToken, port: Number(parsed.port), authorize });
  server.once('close', () => together.client.close());
  server.on('error', () => { console.error('桥接服务启动失败，请检查端口是否被占用。'); together.client.close(); process.exitCode = 1; });
  server.listen(Number(parsed.port), '127.0.0.1', () => {
    console.log(`本地网易云桥接已启动：${info.bridgeUrl}`);
    console.log(`连接配置保存在：${path.join(RUNTIME, '1014_连接配置_v1.json')}（请在本机查看并填入技能设置）`);
    console.log('按 Ctrl+C 停止同步；停止服务不会主动关闭其他成员的房间。');
  });
  const stop = () => { server.close(); server.closeIdleConnections(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof UserError ? error.message : '启动失败，请检查本地配置和依赖。'); process.exitCode = 1; });
}
