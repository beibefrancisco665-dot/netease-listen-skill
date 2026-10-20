import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeCommand } from '../plugins/netease-local-adapter/launch.mjs';

test('桥接在Electron下从PATH启动Node，普通Node复用当前进程路径', () => {
  assert.equal(nodeCommand({}, { versions: { electron: 'test' }, execPath: 'QQAgent.exe' }), 'node');
  assert.equal(nodeCommand({}, { versions: {}, execPath: '/opt/node/bin/node' }), '/opt/node/bin/node');
});
test('自定义Node路径作为单一可执行路径使用，可包含空格', () => {
  assert.equal(nodeCommand({ nodeExecutable: ' C:/Program Files/nodejs/node.exe ' }), 'C:/Program Files/nodejs/node.exe');
});
