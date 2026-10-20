import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.QQA_SOURCE) throw Error('请将 QQA_SOURCE 设为带 src/ 和 node_modules/ 的 QQAgent 应用目录。');
const host = path.resolve(process.env.QQA_SOURCE);
for (const part of ['src/config.js', 'src/plugin-loader.js', 'node_modules']) {
  if (!fs.existsSync(path.join(host, part))) throw Error(`QQA_SOURCE 缺少 ${part}`);
}
const isolated = path.join(repo, '.test-state/loader', String(Date.now()));
const app = path.join(isolated, 'app');
const data = path.join(isolated, 'data');
fs.mkdirSync(app, { recursive: true });
fs.cpSync(path.join(host, 'src'), path.join(app, 'src'), { recursive: true });
for (const dir of ['skills', 'plugins']) fs.cpSync(path.join(repo, dir), path.join(app, dir), { recursive: true });
fs.writeFileSync(path.join(app, 'package.json'), '{"type":"module"}');
fs.symlinkSync(path.join(host, 'node_modules'), path.join(app, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
// Must be set before importing the copied host config; production data is never opened.
process.env.QQ_AGENT_DATA_DIR = data;
const load = file => import(pathToFileURL(path.join(app, file)));
const { setRuntimeConfig, getConfig } = await load('src/config.js');
const { skillManager } = await load('src/skills/manager.js');
const { loadPlugins } = await load('src/plugin-loader.js');
setRuntimeConfig({
  trustedPlugins: ['netease-listen-together', 'netease-song-review', 'netease-local-adapter'],
  skills: {
    'netease-listen-together': { enabled: true, bridgeToken: 'fixture-only', bridgeUrl: 'http://127.0.0.1:32630', allowedChats: 'private:12345', proactiveInvitations: false, autonomousPlayModes: false },
    'netease-song-review': { enabled: true, bridgeToken: 'fixture-only', bridgeUrl: 'http://127.0.0.1:32630', allowedChats: 'private:12345', autonomousDiscovery: false, reactToSongChanges: false, proactiveLikedSongs: false, autonomousLikeSongs: false },
    'netease-local-adapter': { enabled: true, autoStartBridge: false }
  },
  security: { allowPrivateImageHosts: false }
});
try {
  for (let round = 1; round <= 2; round++) {
    const result = await loadPlugins({ roots: { skills: path.join(app, 'skills'), plugins: path.join(app, 'plugins') }, log: () => {} });
    assert.deepEqual(result.failed, []);
    for (const id of ['netease-listen-together', 'netease-song-review', 'netease-local-adapter']) assert.equal(skillManager.isActive(id).active, true);
    const modules = skillManager.list();
    assert.equal(modules.find(s => s.id === 'netease-listen-together').toolIds.length, 14);
    assert.equal(skillManager.getCapabilityProviders('netease.local.fetch').length, 1);
    const hooks = await skillManager.runHook('before-tool', { chatKey: 'private:12345', sessionId: 'fixture-' + round, proactive: true, toolName: 'netease-listen-together__choose' });
    assert(!hooks.some(x => x.value?.block));
    console.log(`PASS 宿主加载/重载第 ${round} 轮：14 工具，单一适配提供者，普通音乐会话可选歌。`);
  }
  assert.equal(getConfig().security.allowPrivateImageHosts, false);
} finally {
  skillManager.disposeAll();
}
