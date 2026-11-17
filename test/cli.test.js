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

test('SSH probe explains its temporary change and does not claim SSH is enabled', async () => {
  const messages=[];
  const code=await main(['--host','host.test','ssh','probe'], {
    out:x=>messages.push(x), err:x=>messages.push(x), defaultCertDirectory:()=> 'test',
    connect:async()=>({}), getWebDavCredentials:async()=>({}), makeWebDavRequest:()=>()=>{},
    probeNewlineDirectory:async()=>({created:true,removed:true}),
  });
  assert.equal(code,0); assert.match(messages.join('\n'),/创建一个随机名称的临时目录并删除/);
  assert.match(messages.join('\n'),/SSH 尚未开启/);
});

test('SSH probe reports a recovery path if cleanup is uncertain', async () => {
  const {ProbeCleanupError}=await import('../src/webdav.js'); const errors=[];
  const code=await main(['--host','host.test','ssh','probe'], {
    out:()=>{}, err:x=>errors.push(x), defaultCertDirectory:()=> 'test', connect:async()=>({}),
    getWebDavCredentials:async()=>({}), makeWebDavRequest:()=>()=>{},
    probeNewlineDirectory:async()=>{throw new ProbeCleanupError('清理未确认','/pool0/data/test/');},
  });
  assert.equal(code,1); assert.match(errors.join('\n'), /\/pool0\/data\/test\//);
});
