import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { DeviceError, Transport, defaultCertDirectory, tcpOpen } from './client.js';
import { createAccount, listAccounts } from './samba.js';
import { sshPreflight } from './ssh-preflight.js';
import { getWebDavCredentials, makeWebDavRequest, probeNewlineDirectory, ProbeCleanupError } from './webdav.js';

const help = `xiaomi-nas-tool --host NAS_IP [--cert-dir DIR] COMMAND

命令：
  diagnose                      检查认证连接、SSH 端口和 Samba 账号数量
  ssh status                    仅检查 SSH 端口，无需小米客户端或 Samba 账号
  ssh preflight                 只读检查 SSH 方案的文件服务及账号前置条件
  ssh probe                     测试临时目录的创建和清理（不会开启 SSH）
  samba list                    查看 Samba 账号数量
  samba create --username NAME --path /ABSOLUTE/PATH
                                创建一个 Samba 账号（实验性）

当前版本不能开启 SSH 或获取 root。\n`;

export function readPassword(prompt, input = process.stdin, output = process.stderr) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(new DeviceError('创建账号需要交互式终端输入密码。'));
  return new Promise((resolve, reject) => {
    let value = '';
    const originalRaw = input.isRaw;
    readline.emitKeypressEvents(input);
    function finish(error) {
      input.removeListener('keypress', onKey); input.setRawMode(Boolean(originalRaw)); input.pause(); output.write('\n');
      if (error) reject(error); else resolve(value);
    }
    function onKey(str, key = {}) {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new DeviceError('已中断，未提交创建操作。'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (key.ctrl && key.name === 'u') { value = ''; return; }
      if (!key.ctrl && !key.meta && str && !/[\x00-\x1f\x7f]/.test(str)) value += str;
    }
    output.write(prompt); input.on('keypress', onKey); input.setRawMode(true); input.resume();
  });
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const out = dependencies.out ?? console.log, err = dependencies.err ?? console.error;
  const connect = dependencies.connect ?? ((host, dir) => Transport.connect(host, dir));
  const probe = dependencies.tcpOpen ?? tcpOpen;
  const certDir = dependencies.defaultCertDirectory ?? defaultCertDirectory;
  const ask = dependencies.readPassword ?? readPassword;
  const getWebDav = dependencies.getWebDavCredentials ?? getWebDavCredentials;
  const makeRequest = dependencies.makeWebDavRequest ?? makeWebDavRequest;
  const probeDirectory = dependencies.probeNewlineDirectory ?? probeNewlineDirectory;
  let parsed;
  try {
    parsed = parseArgs({args: argv, allowPositionals: true, strict: true, options: {
      host: {type: 'string'}, 'cert-dir': {type: 'string'}, username: {type: 'string'}, path: {type: 'string'}, help: {type: 'boolean', short: 'h'},
    }});
  } catch { err('参数无效；使用 --help 查看用法。'); return 1; }
  if (parsed.values.help) { out(help); return 0; }
  const {host, username, path: sharePath} = parsed.values;
  const command = parsed.positionals.join(' ');
  if (!host || !['diagnose', 'ssh status', 'ssh preflight', 'ssh probe', 'samba list', 'samba create'].includes(command) ||
      (command === 'samba create' ? (!username || !sharePath) : (username !== undefined || sharePath !== undefined))) {
    err('参数无效；使用 --help 查看用法。'); return 1;
  }
  try {
    if (command === 'ssh status') { out('SSH 端口 22：' + (await probe(host, 22) ? '开放（尚未验证登录）' : '不可连接')); return 0; }
    const transport = await connect(host, parsed.values['cert-dir'] ?? certDir());
    out('认证连接：成功');
    if (command === 'ssh preflight') {
      const plan = await sshPreflight(transport);
      out(`文件服务和账号前置检查：通过（现有 Samba 账号 ${plan.existingCount} 个，候选位置 ${plan.candidateId}）`);
      out('这是只读检查；候选位置须在实际创建后重新核对，SSH 尚未开启。');
      return 0;
    }
    if (command === 'ssh probe') {
      out('即将创建一个随机名称的临时目录并删除，验证设备文件服务；不会开启 SSH。');
      try {
        const credentials = await getWebDav(transport);
        await probeDirectory(makeRequest(transport, credentials));
        out('临时目录已创建、删除，并确认不存在。SSH 尚未开启。');
        return 0;
      } catch (error) {
        if (error instanceof ProbeCleanupError) {
          err(`临时目录可能需要手动核对（URL 编码路径）：${error.probePath}`);
        }
        throw error;
      }
    }
    if (command === 'diagnose') {
      out('SSH 端口 22：' + (await probe(host, 22) ? '开放（尚未验证登录）' : '不可连接'));
      try { const accounts = await listAccounts(transport); out(`Samba 账号：${accounts.length} 个${accounts.length ? '' : '（空列表是正常状态）'}`); }
      catch (error) { if (!(error instanceof DeviceError)) throw error; out(`Samba 状态未知：${error.message}`); return 1; }
      return 0;
    }
    if (command === 'samba list') { const accounts = await listAccounts(transport); out(`Samba 账号：${accounts.length} 个${accounts.length ? '' : '（空列表是正常状态）'}`); return 0; }
    const password = await ask('设置 Samba 密码（不会显示）：');
    if (password !== await ask('再次输入密码：')) throw new DeviceError('两次密码不一致，未提交创建操作。');
    const id = await createAccount(transport, username, password, sharePath);
    out(`Samba 账号已创建并读回验证（ID：${id}）。`); return 0;
  } catch (error) {
    err('操作未完成：' + (error instanceof DeviceError ? error.message : '本地运行或网络错误。'));
    return 1;
  }
}
