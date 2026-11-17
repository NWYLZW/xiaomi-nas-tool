import contextlib
import io
import unittest
from unittest.mock import patch
from rp05tool import cli
from rp05tool.client import DeviceError


class CliTest(unittest.TestCase):
    @patch('rp05tool.cli.tcp_open', return_value=False)
    @patch('rp05tool.cli.default_cert_directory', side_effect=AssertionError('certificate not needed'))
    def test_ssh_status_independent_of_authentication(self, _cert, _tcp):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(['--host', 'host.test', 'ssh', 'status']), 0)

    @patch('rp05tool.cli.list_accounts', side_effect=DeviceError('unknown'))
    @patch('rp05tool.cli.tcp_open', return_value=False)
    @patch('rp05tool.cli.Transport')
    @patch('rp05tool.cli.default_cert_directory', return_value='unused')
    def test_diagnose_reports_other_checks_if_samba_unknown(self, _directory, _transport, _tcp, _accounts):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main(['--host', 'host.test', 'diagnose']), 1)
        self.assertIn('认证连接：成功', out.getvalue())
        self.assertIn('SSH 端口 22', out.getvalue())
        self.assertIn('Samba 状态未知', out.getvalue())

if __name__ == '__main__':
    unittest.main()
