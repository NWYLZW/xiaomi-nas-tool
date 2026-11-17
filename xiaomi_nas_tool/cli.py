"""Command-line entry points; no configuration files or device secrets are written."""
import argparse
import getpass
import sys
from .client import DeviceError, Transport, default_cert_directory, tcp_open
from .samba import create_account, list_accounts


def parser():
    p = argparse.ArgumentParser(prog='xiaomi-nas-tool', description='小米智能存储局域网工具（不收集设备信息）')
    p.add_argument('--host', required=True, help='设备的局域网地址')
    p.add_argument('--cert-dir', help='桌面客户端证书目录，默认自动发现')
    subs = p.add_subparsers(dest='command', required=True)
    subs.add_parser('diagnose', help='只读检查认证、SSH 和 Samba 状态')
    ssh = subs.add_parser('ssh', help='SSH 连接状态')
    ssh.add_subparsers(dest='operation', required=True).add_parser('status', help='只检查 SSH 端口')
    samba = subs.add_parser('samba', help='Samba 账号管理')
    operations = samba.add_subparsers(dest='operation', required=True)
    operations.add_parser('list', help='只读检查账号数量')
    create = operations.add_parser('create', help='实验性：创建单个 Samba 账号')
    create.add_argument('--username', required=True)
    create.add_argument('--path', required=True, help='设备上的共享目录绝对路径')
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == 'ssh':
            print('SSH 端口 22：' + ('开放（尚未验证登录）' if tcp_open(args.host, 22) else '不可连接'))
            return 0
        directory = args.cert_dir or default_cert_directory()
        transport = Transport(args.host, directory)
        print('认证连接：成功')
        if args.command == 'diagnose':
            print('SSH 端口 22：' + ('开放（尚未验证登录）' if tcp_open(args.host, 22) else '不可连接'))
            try:
                accounts = list_accounts(transport)
                print('Samba 账号：%d 个%s' % (len(accounts), '（空列表是正常状态）' if not accounts else ''))
            except DeviceError as exc:
                print('Samba 状态未知：%s' % exc)
                return 1
            return 0
        if args.operation == 'list':
            accounts = list_accounts(transport)
            print('Samba 账号：%d 个%s' % (len(accounts), '（空列表是正常状态）' if not accounts else ''))
            return 0
        if not sys.stdin.isatty():
            raise DeviceError('创建账号需要交互式终端输入密码。')
        password = getpass.getpass('设置 Samba 密码（不会显示）：')
        if password != getpass.getpass('再次输入密码：'):
            raise DeviceError('两次密码不一致，未提交创建操作。')
        identifier = create_account(transport, args.username, password, args.path)
        print('Samba 账号已创建并读回验证（ID：%s）。' % identifier)
        return 0
    except (DeviceError, KeyboardInterrupt, EOFError) as exc:
        print('操作未完成：%s' % (str(exc) or '已中断'), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
