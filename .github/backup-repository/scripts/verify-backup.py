#!/usr/bin/env python3
"""Verify the exported ciphertext bundle without extraction or decryption."""
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

EXPECTED = {'manifest.json', 'database.dump.age', 'configuration.tar.gz.age'}


def verify(filename: Path) -> dict:
    with tarfile.open(filename, 'r:gz') as archive:
        members = archive.getmembers()
        if len(members) != len(EXPECTED) or {m.name for m in members} != EXPECTED:
            raise ValueError('unexpected, duplicate or missing bundle members')
        if not all(m.isfile() and not m.issym() and not m.islnk() for m in members):
            raise ValueError('bundle must contain regular files only')
        manifest_member = archive.getmember('manifest.json')
        if manifest_member.size > 16384:
            raise ValueError('manifest is too large')
        manifest = json.load(archive.extractfile(manifest_member))
        if manifest.get('schemaVersion') != 1 or manifest.get('environment') != 'production':
            raise ValueError('wrong manifest identity')
        if manifest.get('stackId') != 'aa-production-primary':
            raise ValueError('wrong stack identity')
        if not re.fullmatch(r'[a-f0-9]{40}', manifest.get('sourceCommit', '')):
            raise ValueError('invalid source commit')
        if not re.fullmatch(r'[a-f0-9]{64}', manifest.get('sourceFingerprint', '')):
            raise ValueError('invalid source fingerprint')
        files = manifest.get('files', [])
        if len(files) != 2 or {f.get('name') for f in files} != EXPECTED - {'manifest.json'}:
            raise ValueError('invalid ciphertext manifest')
        for item in files:
            member = archive.getmember(item['name'])
            if member.size != item['size'] or member.size < 100:
                raise ValueError('ciphertext size mismatch')
            digest = hashlib.sha256()
            with archive.extractfile(member) as stream:
                magic = b'age-encryption.org/v1\n'
                prefix = stream.read(len(magic))
                if prefix != magic:
                    raise ValueError('plaintext or invalid age ciphertext in bundle')
                digest.update(prefix)
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != item['sha256']:
                raise ValueError('ciphertext checksum mismatch')
    return manifest


if __name__ == '__main__':
    try:
        result = verify(Path(sys.argv[1]))
        print('Verified encrypted production backup:', result['sourceCommit'])
    except (ValueError, KeyError, IndexError, OSError, tarfile.TarError, json.JSONDecodeError) as error:
        print('Backup verification failed:', str(error), file=sys.stderr)
        raise SystemExit(1)
