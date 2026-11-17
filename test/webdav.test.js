import test from 'node:test';
import assert from 'node:assert/strict';
import { probeNewlineDirectory, ProbeCleanupError } from '../src/webdav.js';

const nonce = 'a'.repeat(32);
function fake(statuses) {
  const calls = [];
  return {calls, request: async (...args) => {calls.push(args); const v = statuses.shift(); if (v instanceof Error) throw v; return v;}};
}
test('creates a unique newline directory and verifies cleanup', async () => {
  const f = fake([207, 201, 204, 404]);
  assert.deepEqual(await probeNewlineDirectory(f.request, nonce), {created: true, removed: true});
  assert.deepEqual(f.calls.map(c => c[0]), ['PROPFIND', 'MKCOL', 'DELETE', 'PROPFIND']);
  assert.match(f.calls[1][1], /%0A\/$/); assert.equal(f.calls[1][1], f.calls[2][1]);
});
test('does not delete paths when creation is refused or ambiguous', async () => {
  for (const result of [405, new Error('timeout')]) {
    const f = fake([207, result]); await assert.rejects(probeNewlineDirectory(f.request, nonce));
    assert.deepEqual(f.calls.map(c => c[0]), ['PROPFIND', 'MKCOL']);
  }
});
test('cleanup uncertainty includes recovery path without credentials', async () => {
  const f = fake([207, 201, new Error('timeout')]);
  await assert.rejects(probeNewlineDirectory(f.request, nonce), e => e instanceof ProbeCleanupError && e.probePath.includes(nonce));
});
test('stops when parent is not confirmed or nonce invalid', async () => {
  const f = fake([403]); await assert.rejects(probeNewlineDirectory(f.request, nonce)); assert.equal(f.calls.length, 1);
  await assert.rejects(probeNewlineDirectory(f.request, '../not-random'));
});

test('Depth header is used only for PROPFIND, never DELETE or MKCOL', async () => {
  const {EventEmitter} = await import('node:events');
  const {makeWebDavRequest} = await import('../src/webdav.js');
  const captured = [];
  const issue = (options, callback) => {
    captured.push(options);
    const req = new EventEmitter(); req.setTimeout = () => {}; req.end = () => {
      const response = new EventEmitter(); response.statusCode = 204; response.resume = () => queueMicrotask(() => response.emit('end'));
      callback(response);
    };
    return req;
  };
  const request = makeWebDavRequest({host: 'host.test', serverName: 'test', credentials: {}}, {port: 5000, username: 'user', password: 'test'}, 100, issue);
  for (const method of ['PROPFIND', 'MKCOL', 'DELETE']) await request(method, '/pool0/data/test');
  assert.equal(captured[0].headers.Depth, '0');
  assert.equal(Object.hasOwn(captured[1].headers, 'Depth'), false);
  assert.equal(Object.hasOwn(captured[2].headers, 'Depth'), false);
});

test('rejects paths that escape the data directory', async () => {
  const {makeWebDavRequest} = await import('../src/webdav.js');
  const request = makeWebDavRequest({host: 'host.test', serverName: 'test', credentials: {}}, {port: 5000, username: 'user', password: 'test'}, 100, () => {throw new Error('must not send');});
  for (const p of ['/etc/passwd', '/pool0/data/%2e%2e/secret', '/pool0/data/%2E%2E%2Fsecret', '/pool0/data/%xx']) {
    await assert.rejects(request('DELETE', p), /不允许/);
  }
});
