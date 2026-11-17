"""Authenticated transport and narrowly scoped read-only API operations."""
import base64
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl


class DeviceError(Exception):
    """An expected failure whose message does not contain device secrets."""


def default_cert_directory():
    candidates = []
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        candidates.append(Path(os.environ["LOCALAPPDATA"]) / "minasCert")
    if os.name != "nt":
        candidates.append(Path('/Applications/小米智能存储.app/Contents/Resources/extraResources/cert'))
    for candidate in candidates:
        if candidate.is_dir() and list(candidate.glob('*_cert.pem')):
            return candidate
    raise DeviceError('找不到客户端证书，请先安装小米智能存储桌面端并登录设备，或传入 --cert-dir。')


def cert_details(directory):
    directory = Path(directory).expanduser()
    candidates = sorted(directory.glob('*_cert.pem'))
    if len(candidates) != 1:
        raise DeviceError('证书目录中应恰好有一个客户端证书；多个设备请使用 --cert-dir 指定单独目录。')
    cert = candidates[0]
    key = cert.with_name(cert.name[:-len('_cert.pem')] + '_private_key.pem')
    ca = directory / 'ca_chain.pem'
    if not key.is_file() or not ca.is_file():
        raise DeviceError('客户端证书缺少配套私钥或 CA。')
    try:
        text = cert.read_text(encoding='ascii')
        der = base64.b64decode(''.join(text.splitlines()[1:-1]), validate=True)
        names = set(re.findall(rb'nas\.[0-9]+\.[0-9a-f]+', der))
        if len(names) != 1:
            raise ValueError('certificate identity is ambiguous')
        prefix = names.pop().decode('ascii')
        context = ssl.create_default_context(cafile=str(ca))
        context.load_cert_chain(str(cert), str(key))
    except (OSError, ValueError, ssl.SSLError) as exc:
        raise DeviceError('无法加载客户端证书；请使用支持 Ed25519 的较新 Python/OpenSSL。') from exc
    return context, prefix


class Transport:
    """TLS peer identity is validated with the application-provided CA and SNI."""
    def __init__(self, host, cert_dir, timeout=8):
        self.host, self.timeout = host, timeout
        self.context, prefix = cert_details(cert_dir)
        self.server_name = None
        for role in ('0', '00', '1', '2', '20'):
            name = prefix + '.' + role
            try:
                with socket.create_connection((host, 443), timeout=timeout) as raw:
                    with self.context.wrap_socket(raw, server_hostname=name):
                        pass
                self.server_name = name
                break
            except (OSError, ssl.SSLError):
                continue
        if not self.server_name:
            raise DeviceError('无法验证 NAS TLS 身份；请确认地址、客户端登录设备以及系统时间。')

    def request(self, endpoint, body):
        if not re.fullmatch(r'/cgi-bin/luci/[a-z_]+/[a-z_]+', endpoint):
            raise DeviceError('不允许的 API 路径。')
        payload = json.dumps(body, ensure_ascii=True).encode('utf-8')
        try:
            with socket.create_connection((self.host, 443), timeout=self.timeout) as raw:
                with self.context.wrap_socket(raw, server_hostname=self.server_name) as sock:
                    sock.settimeout(self.timeout)
                    sock.sendall(b'POST ' + endpoint.encode('ascii') + b' HTTP/1.1\r\nHost: n\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ' + str(len(payload)).encode('ascii') + b'\r\n\r\n' + payload)
                    response = http.client.HTTPResponse(sock)
                    response.begin()
                    if not 200 <= response.status < 300:
                        raise DeviceError('NAS API 返回 HTTP 错误。')
                    content = response.read(1024 * 1024 + 1)
            if len(content) > 1024 * 1024:
                raise DeviceError('NAS API 响应过大。')
            result = json.loads(content)
        except DeviceError:
            raise
        except (OSError, ValueError, http.client.HTTPException) as exc:
            raise DeviceError('NAS API 通信失败，结果不确定；没有自动重试。') from exc
        if not isinstance(result, dict) or type(result.get('code')) is not int:
            raise DeviceError('NAS API 返回格式不完整，结果不确定。')
        return result

    def call(self, endpoint, body):
        result = self.request(endpoint, body)
        if result['code'] != 0:
            raise DeviceError('NAS API 报错（代码 %d）。' % result['code'])
        return result.get('data')


def tcp_open(host, port, timeout=2):
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False
