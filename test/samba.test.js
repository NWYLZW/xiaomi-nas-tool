import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceError } from '../src/client.js';
import { createAccount, listAccounts } from '../src/samba.js';

class Fake {
  constructor(responses) { this.responses = responses; this.calls = []; }
  async call(path, body) { this.calls.push([path, body]); const item = this.responses.shift(); if (item instanceof Error) throw item; return item; }
  async request(path, body) { return this.call(path, body); }
}
const entry = (id, username = 'new', share = '/data/shared') => ({id, username, share_dir: [share]});

test('empty list is valid; missing or malformed list is unknown', async () => {
  assert.deepEqual(await listAccounts(new Fake([{account: []}])), []);
  for (const data of [null, {}, {account: null}, {account: 'bad'}]) await assert.rejects(listAccounts(new Fake([data])), DeviceError);
});
test('duplicate IDs are rejected even when their types differ', async () => {
  await assert.rejects(listAccounts(new Fake([{account: [entry(1), entry('1')]}])), DeviceError);
});
test('first account uses the ID assigned by the server', async () => {
  const api = new Fake([{account: []}, {}, {account: []}, {code: 0, data: {id: 7}}, {account: [entry(7)]}]);
  assert.equal(await createAccount(api, 'new', 'test-password', '/data/shared'), '7');
  assert.equal(Object.hasOwn(api.calls.at(-2)[1], 'id'), false);
});
test('old accounts preserved and different assigned ID accepted', async () => {
  const old = entry(1, 'existing', '/data/elsewhere');
  const api = new Fake([{account: [old]}, {}, {account: [old]}, {code: 0}, {account: [old, entry(2)]}]);
  assert.equal(await createAccount(api, 'new', 'test-password', '/data/shared'), '2');
});
test('existing username or concurrent change stops before writing', async () => {
  const existing = new Fake([{account: [entry(1, 'NEW')]}]);
  await assert.rejects(createAccount(existing, 'new', 'test-password', '/data/shared')); assert.equal(existing.calls.length, 1);
  const changed = new Fake([{account: []}, {}, {account: [entry(8, 'another')]}]);
  await assert.rejects(createAccount(changed, 'new', 'test-password', '/data/shared')); assert.equal(changed.calls.length, 3);
});
test('uncertain write is not retried and no deletion attempted', async () => {
  const api = new Fake([{account: []}, {}, {account: []}, new DeviceError('timeout')]);
  await assert.rejects(createAccount(api, 'new', 'test-password', '/data/shared'), /不确定/);
  assert.equal(api.calls.length, 4); assert.equal(api.calls.some(([p]) => p.includes('delete')), false);
});
test('changed existing account, wrong result and ID mismatch fail', async () => {
  const old = entry(1, 'old');
  for (const [response, accounts] of [[{code: 0}, [entry(1, 'changed'), entry(2)]], [{code: 0}, [old, entry(2, 'wrong')]], [{code: 0, data: {id: 3}}, [old, entry(2)]]]) {
    const api = new Fake([{account: [old]}, {}, {account: [old]}, response, {account: accounts}]);
    await assert.rejects(createAccount(api, 'new', 'test-password', '/data/shared'));
  }
});
test('failure does not reveal sensitive API data or password', async () => {
  const api = new Fake([{account: []}, {}, {account: []}, {code: 123, password: 'should-not-appear'}]);
  await assert.rejects(createAccount(api, 'new', 'test-password', '/data/shared'), err => !err.message.includes('should-not-appear') && !err.message.includes('test-password'));
});
