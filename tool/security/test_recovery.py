import importlib.util
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('recovery.py'))
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.key, self.cert = self.root / 'key.pem', self.root / 'cert.pem'
        recovery.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', str(self.key), '-out', str(self.cert), '-subj', '/CN=offline-fixture', '-days', '1'])
        self.stage = self.root / 'stage'
        (self.stage / 'database').mkdir(parents=True)
        (self.stage / 'storage').mkdir()
        for name in ('roles', 'schema', 'data'):
            (self.stage / 'database' / (name + '.sql')).write_text('-- synthetic ' + name + '\n')
        self.blob = 'storage/' + 'a' * 64
        (self.stage / self.blob).write_bytes(b'fixture image bytes\x00\xff')
        self.manifest = {'schema_version': 1, 'storage': {'buckets': [{'id': 'private'}],
            'objects': [{'bucket': 'private', 'name': 'account/image.png', 'backup_file': self.blob}]}}
        self.archive = self.root / 'snapshot.cms'

    def seal(self):
        return recovery.package(self.stage, self.archive, self.cert, self.manifest)

    def test_database_and_binary_storage_round_trip_to_offline_files(self):
        receipt = self.seal()
        target = self.root / 'restored'
        result = recovery.verify(self.archive, self.key, self.cert, target)
        self.assertEqual(result['verified_files'], 4)
        self.assertEqual(result['storage_objects'], 1)
        self.assertFalse(result['database_replay_verified'])
        self.assertEqual((target / self.blob).read_bytes(), (self.stage / self.blob).read_bytes())
        self.assertEqual((target / 'database/data.sql').read_bytes(), (self.stage / 'database/data.sql').read_bytes())
        self.assertEqual(self.archive.stat().st_mode & 0o777, 0o600)
        self.assertEqual(receipt['archive_sha256'], recovery.digest(self.archive))
        self.assertNotIn(b'fixture image bytes', self.archive.read_bytes())

    def test_managed_schema_round_trip_is_additive_to_old_archive_format(self):
        self.manifest['schema_version'] = 2
        managed = self.stage / 'database/managed.sql'
        managed.write_text('-- synthetic auth and storage schemas\n')
        self.seal()
        target = self.root / 'managed-restore'
        result = recovery.verify(self.archive, self.key, self.cert, target)
        self.assertEqual(result['verified_files'], 5)
        self.assertEqual((target / 'database/managed.sql').read_bytes(), managed.read_bytes())
        self.assertFalse(result['database_replay_verified'])

    def test_combined_schema_entrypoint_round_trip(self):
        self.manifest['schema_version'] = 2
        self.manifest['schema_entrypoint'] = 'database/complete_schema.sql'
        (self.stage / 'database/managed.sql').write_text('-- managed schemas\n')
        (self.stage / 'database/complete_schema.sql').write_text('-- combined dependency order\n')
        self.seal()
        result = recovery.verify(self.archive, self.key, self.cert)
        self.assertEqual(result['verified_files'], 6)

    def test_new_archive_requires_managed_service_schema(self):
        self.manifest['schema_version'] = 2
        self.seal()
        with self.assertRaisesRegex(ValueError, 'Missing managed service schema'):
            recovery.verify(self.archive, self.key, self.cert)

    def test_keychain_verification_never_logs_or_retains_the_private_key(self):
        self.seal()
        original = recovery.run
        key_paths = []
        def run(command, **kwargs):
            if command[:3] == ['openssl', 'cms', '-decrypt']:
                key = Path(command[command.index('-inkey') + 1])
                key_paths.append(key)
                self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            return original(command, **kwargs)
        with mock.patch.object(recovery, 'keychain_private_key', return_value=self.key.read_bytes()) as selected, mock.patch.object(recovery, 'run', side_effect=run):
            result = recovery.verify_keychain(self.archive, 'fixture-service', 'fixture-account', self.cert)
        selected.assert_called_once_with('fixture-service', 'fixture-account')
        self.assertEqual(result['verified_files'], 4)
        self.assertTrue(key_paths)
        self.assertTrue(all(not key.exists() for key in key_paths))

    def test_corrupted_ciphertext_never_publishes_restored_files(self):
        self.seal()
        data = bytearray(self.archive.read_bytes())
        data[-25] ^= 1
        self.archive.write_bytes(data)
        target = self.root / 'restored'
        with self.assertRaises((RuntimeError, ValueError)):
            recovery.verify(self.archive, self.key, self.cert, target)
        self.assertFalse(target.exists())

    def test_plaintext_archive_never_reaches_backup_destination(self):
        original = recovery.run
        def inspect(command, **kwargs):
            if command[:3] == ['openssl', 'cms', '-encrypt']:
                plaintext = Path(command[command.index('-in') + 1])
                self.assertNotEqual(plaintext.parent.parent, self.root)
                self.assertNotIn(self.root, plaintext.parents)
                self.assertEqual(plaintext.parent.stat().st_mode & 0o777, 0o700)
            return original(command, **kwargs)
        with mock.patch.object(recovery, 'run', side_effect=inspect):
            self.seal()

    def test_existing_backup_is_never_overwritten(self):
        self.archive.write_bytes(b'existing snapshot')
        with self.assertRaises(ValueError):
            self.seal()
        self.assertEqual(self.archive.read_bytes(), b'existing snapshot')

    def test_source_checkout_cannot_be_a_recovery_destination(self):
        with self.assertRaises(ValueError):
            recovery.outside_repository(recovery.ROOT / 'backup.cms')

    def test_unexpected_archive_path_is_rejected(self):
        (self.stage / 'unexpected-private-file').write_text('not a declared recovery resource')
        self.seal()
        with self.assertRaisesRegex(ValueError, 'Unsafe backup path'):
            recovery.verify(self.archive, self.key, self.cert)

    def test_manifest_cannot_omit_database_or_storage_files(self):
        (self.stage / 'database/data.sql').unlink()
        with self.assertRaisesRegex(ValueError, 'database'):
            self.seal()

    def test_storage_inventory_walks_nested_folders(self):
        client = recovery.Storage('a' * 20, 'fixture-key')
        def request(path, payload=None):
            if path == '/bucket': return [{'id': 'private'}]
            if payload['prefix'] == '': return [{'name': 'account', 'id': None}]
            return [{'name': 'image.png', 'id': 'object-id', 'updated_at': 'fixture', 'metadata': {'size': 3}}]
        with mock.patch.object(client, 'json', side_effect=request):
            result = client.inventory()
        self.assertEqual(result['objects'][0]['name'], 'account/image.png')

    def test_storage_inventory_rejects_traversal(self):
        client = recovery.Storage('a' * 20, 'fixture-key')
        with mock.patch.object(client, 'json', side_effect=[[{'id': 'private'}], [{'name': '../outside', 'id': 'id'}]]):
            with self.assertRaises(ValueError): client.inventory()

    def test_recovery_selects_opaque_secret_and_rejects_legacy_credentials(self):
        opaque = 'sb_secret_' + 'a' * 32
        keys = [{'name': 'service_role', 'type': 'legacy', 'api_key': 'legacy-fixture'},
                {'name': 'default', 'type': 'secret', 'api_key': opaque}]
        self.assertEqual(recovery.choose_storage_key(keys), opaque)
        with self.assertRaises(ValueError):
            recovery.choose_storage_key(keys, 'legacy-fixture')
        with self.assertRaises(ValueError):
            recovery.choose_storage_key(keys[:1])
        with self.assertRaises(ValueError):
            recovery.choose_storage_key([], 'sb_secret_prefix' + '\u2022' * 25)

    def test_storage_sends_secret_only_in_apikey_header(self):
        client = recovery.Storage('a' * 20, 'sb_secret_fixture')
        with mock.patch.object(client.opener, 'open') as opened:
            client.request('/bucket')
        request = opened.call_args.args[0]
        self.assertEqual(request.get_header('Apikey'), 'sb_secret_fixture')
        self.assertIsNone(request.get_header('Authorization'))

    def test_redirects_cannot_forward_a_service_credential(self):
        with self.assertRaises(ValueError):
            recovery.NoRedirects().redirect_request(None, None, 302, 'redirect', {}, 'https://outside.example')


if __name__ == '__main__':
    unittest.main()
