import { DeviceError } from './client.js';
import { listAccounts } from './samba.js';
import { getWebDavCredentials } from './webdav.js';

// This is only a prediction from published 1.0.9.462 observations; every write
// must verify the actual server result before touching or removing anything.
export function planTemporaryAccount(accounts, username) {
  if (!Array.isArray(accounts) || typeof username !== 'string' || !/^u[0-9]+$/.test(username))
    throw new DeviceError('认证身份或 Samba 账号状态不完整。');
  if (accounts.some(account => !account || typeof account.username !== 'string' || !((typeof account.id === 'string') || Number.isInteger(account.id))))
    throw new DeviceError('Samba 账号记录格式不完整。');
  if (accounts.some(account => account.username.toLowerCase() === username.toLowerCase()))
    throw new DeviceError('同名 Samba 账号已存在，不会覆盖或复用已有账号。');
  const ids = new Set(accounts.map(account => String(account.id)));
  if (ids.size !== accounts.length) throw new DeviceError('Samba 账号编号重复。');
  if ([...ids].some(id => !['1', '2'].includes(id)))
    throw new DeviceError('检测到未知的 Samba 账号编号，无法可靠预测空闲位置。');
  const candidate = !ids.has('1') ? '1' : !ids.has('2') ? '2' : null;
  if (!candidate) throw new DeviceError('临时 Samba 账号位置已满。');
  return {candidateId: candidate, existingCount: accounts.length};
}

export async function sshPreflight(transport) {
  const identity = /^nas\.([0-9]+)\.[0-9a-f]+\.(?:0|00|1|2|20)$/.exec(transport.serverName ?? '');
  if (!identity) throw new DeviceError('无法验证设备认证身份。');
  const webdav = await getWebDavCredentials(transport);
  const username = `u${identity[1]}`;
  if (webdav.username !== username) throw new DeviceError('文件服务账号与认证身份不匹配，已停止。');
  const accounts = await listAccounts(transport);
  const plan = planTemporaryAccount(accounts, username);
  const check = await transport.request('/cgi-bin/luci/netshare/judge_samba_account', {username});
  if (check.code !== 0) throw new DeviceError('无法确认临时账号名称可用，已停止。');
  return plan;
}
