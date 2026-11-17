import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporaryAccount, removeTemporaryAccount } from '../src/temporary-samba.js';

const temp = {id: 1, username: 'u123', password: 'random-test', share_dir: ['/data/probe']};
const options = {username: 'u123', password: 'random-test', sharePath: '/data/probe'};
function adapter(initial = []) {
  let state = structuredClone(initial); let nextId = 1; const calls = [];
  return {calls, list: async () => structuredClone(state), checkName: async () => calls.push('check'),
    create: async ({username,password,sharePath}) => {calls.push('create'); state.push({id: nextId, username, password, share_dir: [sharePath]}); return {code:0,id:nextId};},
    remove: async id => {calls.push('remove'); state = state.filter(x => String(x.id) !== id);},
    mutate: f => {state = f(state);}, setNextId: n => {nextId=n;}};
}

test('zero initial accounts: creates, verifies actual ID, removes and verifies empty', async () => {
  const a = adapter(); const owned = await createTemporaryAccount(a, options);
  assert.equal(owned.id, '1'); assert.deepEqual(await removeTemporaryAccount(a, owned), {restored:true});
  assert.deepEqual(await a.list(), []);
});
test('preserves an unrelated preexisting account', async () => {
  const existing = {id:1, username:'other', password:'old', share_dir:['/data/old']};
  const a = adapter([existing]); a.setNextId(2);
  const owned = await createTemporaryAccount(a, options); assert.equal(owned.id, '2');
  await removeTemporaryAccount(a, owned); assert.deepEqual(await a.list(), [existing]);
});
test('does not touch preexisting account with same name', async () => {
  const a = adapter([temp]); await assert.rejects(createTemporaryAccount(a, options), /已存在/); assert.deepEqual(a.calls, []);
});
test('does not delete when account changes or another account appears', async () => {
  for (const change of [s => s.map(x => ({...x,password:'changed'})), s => [...s,{id:2,username:'other'}]]) {
    const a=adapter(); const owned=await createTemporaryAccount(a,options); a.mutate(change);
    await assert.rejects(removeTemporaryAccount(a,owned), /已变化/); assert.equal(a.calls.includes('remove'),false);
  }
});
test('does not guess ownership or delete after an ambiguous create', async () => {
  const a=adapter(); a.create=async () => {throw new Error('timeout');};
  await assert.rejects(createTemporaryAccount(a,options), /不确定/); assert.equal(a.calls.includes('remove'),false);
});
test('does not retry a deletion with an uncertain result', async () => {
  const a=adapter(); const owned=await createTemporaryAccount(a,options); let n=0;
  a.remove=async () => {n++; throw new Error('timeout');};
  await assert.rejects(removeTemporaryAccount(a,owned), /不确定/); assert.equal(n,1);
});
test('does not accept a mismatched server ID or password', async () => {
  const a=adapter(); const create=a.create; a.create=async args => {await create(args); return {code:0,id:2};};
  await assert.rejects(createTemporaryAccount(a,options), /编号/);
  const b=adapter(); const create2=b.create; b.create=async args => create2({...args,password:'other'});
  await assert.rejects(createTemporaryAccount(b,options), /凭据/);
});
