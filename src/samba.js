import { isDeepStrictEqual } from 'node:util';
import { DeviceError } from './client.js';
const base = '/cgi-bin/luci/netshare/';

export async function listAccounts(transport) {
  const data = await transport.call(base + 'get_samba_account', {});
  if (!data || !Array.isArray(data.account)) throw new DeviceError('设备未返回可识别的 Samba 账号列表；不能把未知状态当作空列表。');
  const ids = new Set();
  for (const entry of data.account) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !((typeof entry.id === 'string') || Number.isInteger(entry.id)) || typeof entry.username !== 'string') throw new DeviceError('Samba 账号记录格式不完整，无法安全操作。');
    const id = String(entry.id);
    if (ids.has(id)) throw new DeviceError('Samba 账号 ID 重复，无法安全操作。');
    ids.add(id);
  }
  return data.account;
}

export async function createAccount(transport, username, password, sharePath) {
  if (!username || !password || !sharePath.startsWith('/') || /[\n\r\0]/.test(username) || /[\n\r\0]/.test(sharePath)) throw new DeviceError('账号、密码或绝对共享路径无效。');
  const before = await listAccounts(transport);
  if (before.some(e => e.username.toLowerCase() === username.toLowerCase())) throw new DeviceError('账号已存在，未修改任何账号。');
  await transport.call(base + 'judge_samba_account', {username});
  if (!isDeepStrictEqual(await listAccounts(transport), before)) throw new DeviceError('账号列表发生变化，未提交创建操作。');
  let result;
  try { result = await transport.request(base + 'add_samba_account', {username, password, share_dir: [sharePath]}); }
  catch { throw new DeviceError('创建请求结果不确定，请在客户端核对账号；不要直接重试。'); }
  if (result.code !== 0) throw new DeviceError(`创建设备返回代码 ${result.code}；设备可能已部分写入，请核对后再操作。`);
  let after;
  try { after = await listAccounts(transport); } catch { throw new DeviceError('创建已提交，但无法读取验证结果；请在客户端核对，不要直接重试。'); }
  const original = new Map(before.map(e => [String(e.id), e]));
  const current = new Map(after.map(e => [String(e.id), e]));
  const additions = [...current].filter(([id]) => !original.has(id)).map(([,entry]) => entry);
  if ([...original].some(([id, value]) => !isDeepStrictEqual(current.get(id), value)) || additions.length !== 1) throw new DeviceError('创建后账号列表与预期不符；请在客户端核对，不自动清理。');
  const account = additions[0];
  if (account.username !== username || !isDeepStrictEqual(account.share_dir, [sharePath])) throw new DeviceError('创建的账号或共享路径不匹配；请在客户端核对，不自动清理。');
  if (result.data && typeof result.data === 'object' && Object.hasOwn(result.data, 'id') && String(result.data.id) !== String(account.id)) throw new DeviceError('服务端返回 ID 与读回结果不一致；请在客户端核对。');
  return String(account.id);
}
