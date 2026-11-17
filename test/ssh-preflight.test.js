import test from 'node:test';
import assert from 'node:assert/strict';
import { planTemporaryAccount, sshPreflight } from '../src/ssh-preflight.js';
import { DeviceError } from '../src/client.js';

test('predicts the first available account slot when account list is empty', () => {
  assert.deepEqual(planTemporaryAccount([], 'u123'), {candidateId: '1', existingCount: 0});
});
test('predicts the second slot without modifying an existing account', () => {
  const accounts = [{id: 1, username: 'different'}];
  assert.deepEqual(planTemporaryAccount(accounts, 'u123'), {candidateId: '2', existingCount: 1});
  assert.deepEqual(accounts, [{id: 1, username: 'different'}]);
});
test('refuses collisions, full slots, unknown IDs, or malformed identity', () => {
  for (const [accounts, user] of [[[{id: 1, username: 'U123'}], 'u123'], [[{id: 1, username: 'a'}, {id: 2, username: 'b'}], 'u123'], [[{id: 7, username: 'other'}], 'u123'], [[], 'root']])
    assert.throws(() => planTemporaryAccount(accounts, user), DeviceError);
});
test('preflight reads identity, credentials, accounts and conflict check without writes', async () => {
  const calls = [];
  const t = {serverName: 'nas.123.abcd.0', call: async (path) => {
    calls.push(path);
    if (path.endsWith('get_pool_info')) return {webDAV: {username: 'u123', password: 'secret', port: 5000}};
    if (path.endsWith('get_samba_account')) return {account: []};
    throw new Error('unexpected');
  }, request: async (path) => {calls.push(path); return {code: 0};}};
  assert.equal((await sshPreflight(t)).candidateId, '1');
  assert.equal(calls.length, 3);
  assert.equal(calls.some(p => /add|set|del/.test(p)), false);
});
test('rejects authentication mismatch before querying accounts', async () => {
  const t = {serverName: 'nas.123.abcd.0', call: async () => ({webDAV: {username: 'u456', password: 'secret', port: 5000}})};
  await assert.rejects(sshPreflight(t), /不匹配/);
});
