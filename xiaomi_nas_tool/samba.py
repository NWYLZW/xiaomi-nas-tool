"""Independent SMB account operations. An empty account list is a valid state."""
from .client import DeviceError

BASE = '/cgi-bin/luci/netshare/'


def list_accounts(transport):
    data = transport.call(BASE + 'get_samba_account', {})
    if not isinstance(data, dict) or not isinstance(data.get('account'), list):
        raise DeviceError('设备未返回可识别的 Samba 账号列表；不能把未知状态当作空列表。')
    entries = data['account']
    ids = set()
    for entry in entries:
        if not isinstance(entry, dict) or type(entry.get('id')) not in (str, int) or not isinstance(entry.get('username'), str):
            raise DeviceError('Samba 账号记录格式不完整，无法安全操作。')
        identifier = str(entry['id'])
        if identifier in ids:
            raise DeviceError('Samba 账号 ID 重复，无法安全操作。')
        ids.add(identifier)
    return entries


def create_account(transport, username, password, path):
    """Create once, then verify its actual server-assigned ID and old records.

    An uncertain response is never retried and no automatic delete is attempted.
    Callers must not run concurrent SMB configuration changes during this operation.
    """
    if not username or not password or not path.startswith('/') or any(c in username for c in '\n\r\x00') or any(c in path for c in '\n\r\x00'):
        raise DeviceError('账号、密码或绝对共享路径无效。')
    before = list_accounts(transport)
    if any(e['username'].casefold() == username.casefold() for e in before):
        raise DeviceError('账号已存在，未修改任何账号。')
    transport.call(BASE + 'judge_samba_account', {'username': username})
    # Recheck immediately before a non-idempotent write, without assuming an ID.
    if list_accounts(transport) != before:
        raise DeviceError('账号列表发生变化，未提交创建操作。')
    try:
        result = transport.request(BASE + 'add_samba_account', {'username': username, 'password': password, 'share_dir': [path]})
    except DeviceError as exc:
        raise DeviceError('创建请求结果不确定，请在客户端核对账号；不要直接重试。') from exc
    if result['code'] != 0:
        raise DeviceError('创建设备返回代码 %d；设备可能已部分写入，请核对后再操作。' % result['code'])
    try:
        after = list_accounts(transport)
    except DeviceError as exc:
        raise DeviceError('创建已提交，但无法读取验证结果；请在客户端核对，不要直接重试。') from exc
    old = {str(e['id']): e for e in before}
    new = {str(e['id']): e for e in after}
    additions = [e for key, e in new.items() if key not in old]
    if any(new.get(key) != value for key, value in old.items()) or len(additions) != 1:
        raise DeviceError('创建后账号列表与预期不符；请在客户端核对，不自动清理。')
    account = additions[0]
    if account.get('username') != username or account.get('share_dir') != [path]:
        raise DeviceError('创建的账号或共享路径不匹配；请在客户端核对，不自动清理。')
    reported = result.get('data')
    if isinstance(reported, dict) and 'id' in reported and str(reported['id']) != str(account['id']):
        raise DeviceError('服务端返回 ID 与读回结果不一致；请在客户端核对。')
    return str(account['id'])
