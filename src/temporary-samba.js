import { isDeepStrictEqual } from 'node:util';
import { DeviceError } from './client.js';

// The caller supplies device-specific operations. This module does not guess
// an undocumented deletion API, persist credentials, or delete by ID alone.
function indexed(accounts) {
  if (!Array.isArray(accounts)) throw new DeviceError('账号列表不可用，状态未知。');
  const map = new Map();
  for (const account of accounts) {
    if (!account || typeof account.username !== 'string' || !((typeof account.id === 'string') || Number.isInteger(account.id)))
      throw new DeviceError('账号记录不完整，状态未知。');
    const id = String(account.id);
    if (map.has(id)) throw new DeviceError('账号编号重复，状态未知。');
    map.set(id, account);
  }
  return map;
}

function newOwnedAccount(before, after, username, password, sharePath) {
  const original = indexed(before), current = indexed(after);
  if ([...original].some(([id, value]) => !isDeepStrictEqual(current.get(id), value)))
    throw new DeviceError('已有账号发生变化，不能确认本次操作的归属。');
  const added = [...current].filter(([id]) => !original.has(id));
  if (added.length !== 1) throw new DeviceError('新增账号数量不符合预期，不能确认归属。');
  const [id, account] = added[0];
  if (account.username !== username || account.password !== password || !isDeepStrictEqual(account.share_dir, [sharePath]))
    throw new DeviceError('新增账号的身份、凭据或路径与本次操作不匹配。');
  return {id, account, original};
}

export async function createTemporaryAccount(adapter, {username, password, sharePath}) {
  if (!/^u[0-9]+$/.test(username) || !password || typeof sharePath !== 'string' || !sharePath.startsWith('/'))
    throw new DeviceError('临时账号参数无效。');
  const before = await adapter.list();
  indexed(before);
  if (before.some(account => account.username.toLowerCase() === username.toLowerCase()))
    throw new DeviceError('同名账号已存在，不会复用或覆盖。');
  if (adapter.checkName) await adapter.checkName(username);
  if (!isDeepStrictEqual(before, await adapter.list())) throw new DeviceError('账号列表发生变化，未提交创建操作。');
  let reply;
  try { reply = await adapter.create({username, password, sharePath}); }
  catch { throw new DeviceError('创建结果不确定；不要重试或删除，请先读取设备状态。'); }
  if (!reply || !Number.isInteger(reply.code) || ![0, 2502].includes(reply.code))
    throw new DeviceError('设备未确认创建成功，可能已部分写入；请读取设备状态。');
  let after;
  try { after = await adapter.list(); } catch { throw new DeviceError('创建已提交，但无法读回；请读取设备状态。'); }
  const owned = newOwnedAccount(before, after, username, password, sharePath);
  if (reply.id != null && String(reply.id) !== owned.id)
    throw new DeviceError('设备返回的账号编号与读回不一致。');
  return owned;
}

export async function removeTemporaryAccount(adapter, owned) {
  if (!owned || !(owned.original instanceof Map) || !owned.account || typeof owned.id !== 'string')
    throw new DeviceError('临时账号归属信息不完整，不能删除。');
  const current = indexed(await adapter.list());
  if (!isDeepStrictEqual(current.get(owned.id), owned.account) ||
      [...owned.original].some(([id, account]) => !isDeepStrictEqual(current.get(id), account)) ||
      current.size !== owned.original.size + 1)
    throw new DeviceError('账号配置已变化，保留当前配置，不执行删除。');
  try { await adapter.remove(owned.id); }
  catch { throw new DeviceError('删除结果不确定，请读取设备状态；不要重复删除。'); }
  let after;
  try { after = indexed(await adapter.list()); }
  catch { throw new DeviceError('删除已提交，但无法读回账号状态。'); }
  if (after.size !== owned.original.size || [...owned.original].some(([id, account]) => !isDeepStrictEqual(after.get(id), account)))
    throw new DeviceError('删除后的账号状态与原状不符，请检查设备配置。');
  return {restored: true};
}
