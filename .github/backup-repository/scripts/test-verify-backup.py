import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup_verifier', Path(__file__).with_name('verify-backup.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class BackupBoundaryTests(unittest.TestCase):
    def build(self, path, *, plaintext=False, corruption=False, extra=False, symlink=False):
        blob = (b'POSTGRES_PASSWORD=must-not-leave-the-server\n' if plaintext else
                b'age-encryption.org/v1\n') + b'synthetic-encrypted-payload' * 10
        files = {name: blob for name in ('database.dump.age', 'configuration.tar.gz.age')}
        manifest = {'schemaVersion': 1, 'environment': 'production', 'stackId': 'aa-production-primary',
                    'sourceCommit': 'a' * 40, 'sourceFingerprint': 'b' * 64,
                    'files': [{'name': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                              for name, data in files.items()]}
        if corruption:
            files['database.dump.age'] = blob[:-1] + b'!'
        files['manifest.json'] = json.dumps(manifest).encode()
        if extra:
            files['../stack.env'] = b'must not be accepted'
        with tarfile.open(path, 'w:gz') as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                if symlink and name == 'database.dump.age':
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/etc/passwd'
                    archive.addfile(member)
                else:
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))

    def test_valid_ciphertext_bundle(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / 'backup.tar.gz'
            self.build(filename)
            self.assertEqual(verifier.verify(filename)['stackId'], 'aa-production-primary')

    def test_plaintext_is_rejected_even_with_matching_checksums(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / 'backup.tar.gz'
            self.build(filename, plaintext=True)
            with self.assertRaisesRegex(ValueError, 'plaintext'):
                verifier.verify(filename)

    def test_corrupted_ciphertext_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / 'backup.tar.gz'
            self.build(filename, corruption=True)
            with self.assertRaisesRegex(ValueError, 'checksum'):
                verifier.verify(filename)

    def test_extra_traversal_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / 'backup.tar.gz'
            self.build(filename, extra=True)
            with self.assertRaisesRegex(ValueError, 'unexpected'):
                verifier.verify(filename)

    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / 'backup.tar.gz'
            self.build(filename, symlink=True)
            with self.assertRaisesRegex(ValueError, 'regular files'):
                verifier.verify(filename)


if __name__ == '__main__':
    unittest.main()
