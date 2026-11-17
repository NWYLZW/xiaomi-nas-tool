import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { X509Certificate, createPrivateKey } from 'node:crypto';

export class DeviceError extends Error {}

export function defaultCertDirectory() {
  const candidates = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'minasCert'));
  if (process.platform === 'darwin') candidates.push('/Applications/小米智能存储.app/Contents/Resources/extraResources/cert');
  for (const dir of candidates) {
    try { if (fs.readdirSync(dir).some(name => name.endsWith('_cert.pem'))) return dir; } catch { /* try next */ }
  }
  throw new DeviceError('找不到客户端证书，请先安装小米智能存储桌面端并登录设备，或传入 --cert-dir。');
}

export function certDetails(directory) {
  try {
    if (directory === '~' || directory.startsWith('~/')) directory = path.join(os.homedir(), directory.slice(2));
    const certs = fs.readdirSync(directory).filter(name => name.endsWith('_cert.pem')).sort();
    if (certs.length !== 1) throw new DeviceError('证书目录中应恰好有一个客户端证书；多个设备请使用 --cert-dir 指定单独目录。');
    const cert = fs.readFileSync(path.join(directory, certs[0]));
    const key = fs.readFileSync(path.join(directory, certs[0].slice(0, -'_cert.pem'.length) + '_private_key.pem'));
    const ca = fs.readFileSync(path.join(directory, 'ca_chain.pem'));
    const x509 = new X509Certificate(cert);
    const matches = new Set((x509.raw.toString('latin1').match(/nas\.[0-9]+\.[0-9a-f]+/g) ?? []));
    if (matches.size !== 1 || !x509.checkPrivateKey(createPrivateKey(key))) throw new Error('invalid identity');
    tls.createSecureContext({ca, cert, key});
    return {cert, key, ca, prefix: [...matches][0]};
  } catch (error) {
    if (error instanceof DeviceError) throw error;
    throw new DeviceError('无法加载客户端证书或配套私钥、CA；请确认客户端已登录设备。');
  }
}

function verifyTls(host, name, credentials, timeout) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({host, port: 443, servername: name, ...credentials, rejectUnauthorized: true});
    sock.setTimeout(timeout, () => sock.destroy(new Error('timeout')));
    sock.once('secureConnect', () => { sock.destroy(); resolve(); });
    sock.once('error', () => { sock.destroy(); reject(new Error('TLS failed')); });
  });
}

export class Transport {
  constructor(host, credentials, serverName, timeout = 8000) {
    this.host = host; this.credentials = credentials; this.serverName = serverName; this.timeout = timeout;
  }
  static async connect(host, certDir, timeout = 8000) {
    const {prefix, ...credentials} = certDetails(certDir);
    for (const role of ['0', '00', '1', '2', '20']) {
      const name = `${prefix}.${role}`;
      try { await verifyTls(host, name, credentials, timeout); return new Transport(host, credentials, name, timeout); } catch { /* next identity */ }
    }
    throw new DeviceError('无法验证 NAS TLS 身份；请确认地址、客户端登录设备以及系统时间。');
  }
  async request(endpoint, body) {
    if (!/^\/cgi-bin\/luci\/[a-z_]+\/[a-z_]+$/.test(endpoint)) throw new DeviceError('不允许的 API 路径。');
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message) => { if (!settled) { settled = true; reject(new DeviceError(message)); } };
      const req = https.request({host: this.host, port: 443, path: endpoint, method: 'POST', servername: this.serverName,
        ...this.credentials, rejectUnauthorized: true, agent: false,
        headers: {Host: 'n', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}}, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); fail('NAS API 返回 HTTP 错误。'); return; }
        const chunks = []; let length = 0;
        res.on('data', chunk => { length += chunk.length; if (length > 1048576) { res.destroy(); fail('NAS API 响应过大。'); } else chunks.push(chunk); });
        res.on('aborted', () => fail('NAS API 响应中断，结果不确定；没有自动重试。'));
        res.on('error', () => fail('NAS API 通信失败，结果不确定；没有自动重试。'));
        res.on('end', () => {
          if (settled) return;
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('NAS API 返回格式不完整，结果不确定。'); return; }
          if (!data || typeof data !== 'object' || Array.isArray(data) || !Number.isInteger(data.code)) { fail('NAS API 返回格式不完整，结果不确定。'); return; }
          settled = true; resolve(data);
        });
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error('timeout')));
      req.on('error', () => fail('NAS API 通信失败，结果不确定；没有自动重试。'));
      req.end(payload);
    });
  }
  async call(endpoint, body) {
    const result = await this.request(endpoint, body);
    if (result.code !== 0) throw new DeviceError(`NAS API 报错（代码 ${result.code}）。`);
    return result.data;
  }
}

export function tcpOpen(host, port, timeout = 2000) {
  return new Promise(resolve => {
    const socket = net.createConnection({host, port});
    socket.setTimeout(timeout);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}
