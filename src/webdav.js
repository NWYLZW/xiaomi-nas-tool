import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { DeviceError } from './client.js';

// Requests deliberately expose only HTTP status, never response bodies or credentials.
export async function getWebDavCredentials(transport) {
  const data = await transport.call('/cgi-bin/luci/filemgr/get_pool_info', {selector: ['webDAV']});
  const info = data?.webDAV;
  if (!info || typeof info.username !== 'string' || !info.username || typeof info.password !== 'string' || !info.password || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535)
    throw new DeviceError('设备未返回完整的 WebDAV 连接信息。');
  return { username: info.username, password: info.password, port: info.port };
}

export function makeWebDavRequest(transport, credentials, timeout = 8000, issueRequest = https.request) {
  return (method, requestPath) => new Promise((resolve, reject) => {
    let decoded;
    try { decoded = decodeURIComponent(requestPath); } catch { decoded = ''; }
    if (!['PROPFIND', 'MKCOL', 'DELETE'].includes(method) || !requestPath.startsWith('/pool0/data/') ||
        !decoded.startsWith('/pool0/data/') || decoded.split('/').some(part => part === '.' || part === '..')) {
      reject(new DeviceError('不允许的 WebDAV 操作或路径。')); return;
    }
    let done = false;
    const finish = (error, status) => {
      if (done) return;
      done = true;
      if (error) reject(new DeviceError('WebDAV 请求未确认完成；不要盲目重试或删除现有目录。'));
      else resolve(status);
    };
    const request = issueRequest({host: transport.host, port: credentials.port, path: requestPath, method,
      servername: transport.serverName, ...transport.credentials, rejectUnauthorized: true, agent: false,
      headers: {Host: 'n', ...(method === 'PROPFIND' ? {Depth: '0'} : {}), Authorization: 'Basic ' + Buffer.from(credentials.username + ':' + credentials.password).toString('base64')}}, response => {
      const status = response.statusCode;
      response.on('error', () => finish(true));
      response.on('aborted', () => finish(true));
      response.on('end', () => finish(false, status));
      response.resume();
    });
    request.setTimeout(timeout, () => request.destroy(new Error('timeout')));
    request.on('error', () => finish(true));
    request.end();
  });
}

export class ProbeCleanupError extends DeviceError {
  constructor(message, probePath) { super(message); this.probePath = probePath; }
}

// Only an explicit 201 establishes ownership; an ambiguous create is never deleted.
export async function probeNewlineDirectory(request, nonce = randomBytes(16).toString('hex')) {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new DeviceError('临时目录标识无效。');
  const target = '/pool0/data/' + encodeURIComponent(`.xiaomi-nas-tool-probe-${nonce}\n`) + '/';
  const rootStatus = await request('PROPFIND', '/pool0/data/');
  if (rootStatus !== 207) throw new DeviceError(`无法验证存储根目录（HTTP ${rootStatus}）。`);
  let createStatus;
  try { createStatus = await request('MKCOL', target); }
  catch { throw new ProbeCleanupError('临时目录创建结果不确定；请检查设备，不要自动重试。', target); }
  if (createStatus !== 201) throw new DeviceError(`测试目录未创建（HTTP ${createStatus}）。`);
  let deleteStatus;
  try { deleteStatus = await request('DELETE', target); }
  catch { throw new ProbeCleanupError('测试目录已创建，但清理请求结果不确定。', target); }
  if (![200, 204].includes(deleteStatus)) throw new ProbeCleanupError(`测试目录清理未确认（HTTP ${deleteStatus}）。`, target);
  let verify;
  try { verify = await request('PROPFIND', target); }
  catch { throw new ProbeCleanupError('删除已提交，但未能核实测试目录是否消失。', target); }
  if (verify !== 404) throw new ProbeCleanupError(`无法核实测试目录已删除（HTTP ${verify}）。`, target);
  return {created: true, removed: true};
}
