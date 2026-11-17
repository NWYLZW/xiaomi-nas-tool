import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { main, readPassword } from '../src/cli.js';
import { DeviceError } from '../src/client.js';

test('SSH status needs neither certificate nor Samba', async () => {
  const messages = [];
  const code = await main(['--host', 'host.test', 'ssh', 'status'], {out: x => messages.push(x), tcpOpen: async () => false, defaultCertDirectory: () => {throw Error('not needed');}});
  assert.equal(code, 0); assert.match(messages.join('\n'), /SSH 端口 22/);
});
test('diagnostics retain other results if Samba state is unknown', async () => {
  const messages = [];
  const code = await main(['--host', 'host.test', 'diagnose'], {out: x => messages.push(x), tcpOpen: async () => false, defaultCertDirectory: () => 'x', connect: async () => ({call: async () => {throw new DeviceError('unknown');}})});
  assert.equal(code, 1); assert.match(messages.join('\n'), /认证连接：成功/); assert.match(messages.join('\n'), /Samba 状态未知/);
});
test('interactive password is not echoed and terminal raw mode is restored', async () => {
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false; input.setRawMode = state => {input.isRaw = state;};
  let output = ''; const target = {write: x => {output += x;}};
  const result = readPassword('Password: ', input, target);
  input.emit('keypress', 'secret', {name: 's'}); input.emit('keypress', '\r', {name: 'return'});
  assert.equal(await result, 'secret'); assert.equal(input.isRaw, false); assert.equal(output.includes('secret'), false);
});
test('noninteractive password input is rejected', async () => { await assert.rejects(readPassword('x', {isTTY: false}), /交互式终端/); });
test('help explains that SSH cannot be enabled', async () => {
  const messages = []; assert.equal(await main(['--help'], {out: x => messages.push(x)}), 0); assert.match(messages[0], /不能开启 SSH/);
});
