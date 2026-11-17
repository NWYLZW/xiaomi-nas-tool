import unittest
from xiaomi_nas_tool.client import DeviceError
from xiaomi_nas_tool.samba import create_account, list_accounts


class Fake:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def call(self, path, data):
        self.calls.append((path, data))
        value = self.responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    def request(self, path, data):
        return self.call(path, data)


def entry(identifier, username='new', path='/data/shared'):
    return {'id': identifier, 'username': username, 'share_dir': [path]}


class AccountsTest(unittest.TestCase):
    def test_empty_list_is_valid(self):
        self.assertEqual(list_accounts(Fake([{'account': []}])), [])

    def test_missing_list_is_unknown(self):
        for data in (None, {}, {'account': None}, {'account': 'bad'}):
            with self.subTest(data=data), self.assertRaises(DeviceError):
                list_accounts(Fake([data]))

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaises(DeviceError):
            list_accounts(Fake([{'account': [entry(1), entry('1')]}]))

    def test_empty_account_list_create_uses_assigned_id(self):
        nas = Fake([{'account': []}, {}, {'account': []}, {'code': 0, 'data': {'id': 7}}, {'account': [entry(7)]}])
        self.assertEqual(create_account(nas, 'new', 'secret', '/data/shared'), '7')
        self.assertEqual(nas.calls[-2][0].split('/')[-1], 'add_samba_account')
        self.assertNotIn('id', nas.calls[-2][1])

    def test_preserves_existing_and_uses_other_id(self):
        old = entry(1, 'existing', '/data/elsewhere')
        nas = Fake([{'account': [old]}, {}, {'account': [old]}, {'code': 0}, {'account': [old, entry(2)]}])
        self.assertEqual(create_account(nas, 'new', 'secret', '/data/shared'), '2')

    def test_existing_username_stops_before_write(self):
        nas = Fake([{'account': [entry(1, 'NEW')]}])
        with self.assertRaises(DeviceError):
            create_account(nas, 'new', 'secret', '/data/shared')
        self.assertEqual(len(nas.calls), 1)

    def test_concurrent_change_stops_before_write(self):
        nas = Fake([{'account': []}, {}, {'account': [entry(8, 'another')]}])
        with self.assertRaises(DeviceError):
            create_account(nas, 'new', 'secret', '/data/shared')
        self.assertEqual(len(nas.calls), 3)

    def test_uncertain_write_no_retry_no_delete(self):
        nas = Fake([{'account': []}, {}, {'account': []}, DeviceError('timeout')])
        with self.assertRaisesRegex(DeviceError, '不确定'):
            create_account(nas, 'new', 'secret', '/data/shared')
        self.assertEqual(len(nas.calls), 4)
        self.assertFalse(any('delete' in p for p, _ in nas.calls))

    def test_rejects_mismatch_or_changed_existing(self):
        old = entry(1, 'old')
        for after in ([entry(1, 'changed'), entry(2)], [old, entry(2, 'wrong')]):
            with self.subTest(after=after):
                nas = Fake([{'account': [old]}, {}, {'account': [old]}, {'code': 0}, {'account': after}])
                with self.assertRaises(DeviceError):
                    create_account(nas, 'new', 'secret', '/data/shared')

    def test_error_does_not_include_sensitive_response(self):
        nas = Fake([{'account': []}, {}, {'account': []}, {'code': 123, 'password': 'do-not-print'}])
        with self.assertRaises(DeviceError) as caught:
            create_account(nas, 'new', 'secret', '/data/shared')
        self.assertNotIn('do-not-print', str(caught.exception))
        self.assertNotIn('secret', str(caught.exception))

if __name__ == '__main__':
    unittest.main()
