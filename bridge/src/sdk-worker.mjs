import { parentPort, workerData } from 'node:worker_threads';
import { createRequire, Module } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const pairPaths = new Set(['room/check', 'room/create', 'play/invitation/accept', 'status/get', 'heartbeat', 'sync/playlist/get', 'sync/list/command/report', 'play/command/report', 'end/v2'].map(s => `/api/listen/together/${s}`));

// Keep SDK caches inside this project; isolate and suppress third-party credential-bearing logs.
const cache = path.join(workerData.root, 'runtime', 'sdk-cache');
fs.mkdirSync(cache, { recursive: true });
process.env.TEMP = cache; process.env.TMP = cache; process.env.TMPDIR = cache;
const anonymous = path.join(cache, 'anonymous_token');
if (!fs.existsSync(anonymous)) fs.writeFileSync(anonymous, '', { mode: 0o600 });
for (const name of ['log', 'warn', 'error', 'info', 'debug']) console[name] = () => {};

try {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@neteasecloudmusicapienhanced/api');
  const sdkRoot = path.dirname(entry);
  const requestFile = path.join(sdkRoot, 'util', 'request.js');
  let source = fs.readFileSync(requestFile, 'utf8');
  function replace(before, after) {
    if (!source.includes(before)) throw new Error('Pinned SDK source changed');
    source = source.replace(before, after);
  }
  // In-memory adaptation of 4.40.1: keep the server-issued NMTID and probe before fallback.
  // No installed source is overwritten. Protocol rationale and attribution are in the research note.
  replace('// 预先定义osMap', "let qqaNmtid = '';\nlet qqaProbeLeft = 3;\n// 预先定义osMap");
  replace("const processCookieObject = (cookie, uri) => {", "const processCookieObject = (cookie, uri, selectedCrypto) => {");
  replace("if (uri.indexOf('login') === -1) {\n    processedCookie['NMTID'] = CryptoJS.lib.WordArray.random(16).toString()\n  }",
    "if (cookie.NMTID || qqaNmtid) {\n    processedCookie.NMTID = cookie.NMTID || qqaNmtid\n  } else if (qqaProbeLeft <= 0 || selectedCrypto !== 'eapi') {\n    processedCookie.NMTID = '00O' + CryptoJS.lib.WordArray.random(19).toString()\n  }");
  replace('cookie = processCookieObject(cookie, uri)', "cookie = processCookieObject(cookie, uri, options.crypto || (APP_CONF.encrypt ? 'eapi' : 'api'))");
  replace("if (cookie.MUSIC_A) header['MUSIC_A'] = cookie.MUSIC_A", "if (cookie.MUSIC_A) header['MUSIC_A'] = cookie.MUSIC_A\n        if (crypto === 'eapi' && cookie.NMTID) header.NMTID = cookie.NMTID");
  replace('const body = res.data', "const body = res.data\n        if (crypto === 'eapi' && !cookie.NMTID && qqaProbeLeft > 0) {\n          qqaProbeLeft--\n          for (const raw of res.headers['set-cookie'] || []) {\n            const match = raw.match(/(?:^|;\\s*)NMTID=([^;]+)/)\n            if (match) qqaNmtid = match[1]\n          }\n        }");
  const compiled = new Module(requestFile);
  compiled.filename = requestFile;
  compiled.paths = Module._nodeModulePaths(path.dirname(requestFile));
  compiled._compile(source, requestFile);
  const request = compiled.exports;
  const axios = createRequire(entry)('axios').default;
  axios.defaults.timeout = 12000;
  const { cookieToJson } = require(path.join(sdkRoot, 'util', 'index.js'));
  const names = ['login_qr_key', 'login_qr_create', 'login_qr_check', 'login_status', 'api', 'song_detail', 'cloudsearch', 'song_url_v1', 'song_url', 'lyric', 'like', 'likelist'];
  const modules = Object.fromEntries(names.map(name => [name, require(path.join(sdkRoot, 'module', `${name}.js`))]));
  let keyReady = null;
  parentPort.postMessage({ ready: true });
  let work = Promise.resolve();
  parentPort.on('message', ({ id, name, args }) => {
    work = work.then(async () => {
      let stage = 'request';
      try {
        if (!Object.hasOwn(modules, name)) throw new Error('Forbidden module');
        if (name === 'api' && !pairPaths.has(args.uri)) throw new Error('Forbidden pair endpoint');
        if (name === 'song_url_v1' && (!args.crypto || args.crypto === 'xeapi')) {
          stage = 'xeapi_key';
          if (!keyReady) keyReady = require(path.join(sdkRoot, 'util', 'xeapiKey.js')).getXeapiPublicKey()
            .then(key => fs.writeFileSync(path.join(cache, 'xeapi_public_key'), JSON.stringify(key), { mode: 0o600 }))
            .catch(error => { keyReady = null; throw error; });
          await keyReady;
        }
        stage = 'request';
        const cookie = typeof args.cookie === 'string' ? cookieToJson(args.cookie) : {};
        const response = await modules[name]({ ...args, cookie }, request);
        parentPort.postMessage({ id, response });
      } catch (error) {
        parentPort.postMessage({ id, errorCode: Number(error?.body?.code || 502), stage });
      }
    });
  });
} catch {
  parentPort.postMessage({ ready: false });
  parentPort.close();
}
