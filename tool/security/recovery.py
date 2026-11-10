#!/usr/bin/env python3
"""Encrypted Supabase logical/database and Storage backup; offline file verification.

Credentials stay in process memory. This tool never uploads or restores a database.
"""
from __future__ import annotations
import argparse
import ctypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def run(command, *, cwd=None):
    result = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # CLI diagnostics may contain connection strings or account content.
        raise RuntimeError(f'{command[0]} failed with status {result.returncode}; no backup published')
    return result.stdout


def outside_repository(path):
    path = path.expanduser().resolve()
    if path == ROOT or ROOT in path.parents or any((parent / '.git').exists() for parent in (path, *path.parents)):
        raise ValueError('Recovery material must be outside the source checkout')
    return path


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Storage redirects are forbidden')


class Storage:
    def __init__(self, ref, key):
        if not re.fullmatch(r'[a-z0-9]{20}', ref):
            raise ValueError('Invalid project reference')
        self.origin = f'https://{ref}.supabase.co/storage/v1'
        self.key = key
        self.opener = urllib.request.build_opener(NoRedirects())

    def request(self, path, payload=None):
        req = urllib.request.Request(self.origin + path,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={'apikey': self.key, 'Content-Type': 'application/json'})
        return self.opener.open(req, timeout=90)

    def json(self, path, payload=None):
        with self.request(path, payload) as response:
            return json.load(response)

    def inventory(self):
        buckets = sorted(self.json('/bucket'), key=lambda row: row['id'])
        objects = []
        for bucket in buckets:
            pending, seen, names = [''], set(), set()
            while pending:
                prefix = pending.pop()
                if prefix in seen:
                    raise ValueError('Repeated Storage folder')
                seen.add(prefix)
                offset = 0
                while True:
                    rows = self.json('/object/list/' + urllib.parse.quote(bucket['id'], safe=''),
                        {'prefix': prefix, 'limit': 1000, 'offset': offset,
                         'sortBy': {'column': 'name', 'order': 'asc'}})
                    for row in rows:
                        name = prefix + row['name']
                        if not name or any(part in ('.', '..') for part in name.split('/')):
                            raise ValueError('Unsafe Storage object name')
                        if row.get('id') is None:
                            pending.append(name.rstrip('/') + '/')
                        else:
                            if name in names:
                                raise ValueError('Unstable Storage inventory')
                            names.add(name)
                            objects.append({'bucket': bucket['id'], 'name': name,
                                'id': row['id'], 'updated_at': row.get('updated_at'),
                                'metadata': row.get('metadata')})
                    if len(rows) < 1000:
                        break
                    offset += len(rows)
        return {'buckets': buckets, 'objects': sorted(objects, key=lambda row: (row['bucket'], row['name']))}

    def download(self, item, path):
        expected = (item.get('metadata') or {}).get('size')
        if not isinstance(expected, int) or isinstance(expected, bool) or expected < 0:
            raise ValueError('Missing or invalid Storage object size')
        url = '/object/authenticated/' + urllib.parse.quote(item['bucket'], safe='') + '/' + urllib.parse.quote(item['name'], safe='/')
        with self.request(url) as response, path.open('xb') as output:
            for block in iter(lambda: response.read(1024 * 1024), b''):
                output.write(block)
            if output.tell() != expected:
                raise ValueError('Storage download size mismatch; no archive published')


def package(staging, output, certificate, manifest):
    if output.exists():
        raise ValueError('Refusing to replace an existing backup')
    required = {'database/roles.sql', 'database/schema.sql', 'database/data.sql'}
    if not all((staging / name).is_file() for name in required):
        raise ValueError('Incomplete database backup')
    files = [p for p in staging.rglob('*') if p.is_file()]
    if any(p.is_symlink() for p in files):
        raise ValueError('Recovery source contains a symlink')
    manifest['files'] = {p.relative_to(staging).as_posix():
        {'sha256': digest(p), 'size': p.stat().st_size} for p in sorted(files)}
    (staging / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True) + '\n')
    with tempfile.TemporaryDirectory(prefix='haw-seal-') as work:
        work = Path(work)
        with tarfile.open(work / 'snapshot.tar', 'w') as archive:
            for p in sorted(staging.rglob('*')):
                if p.is_file():
                    archive.add(p, arcname=p.relative_to(staging), recursive=False)
        sealed = work / 'sealed.cms'
        run(['openssl', 'cms', '-encrypt', '-aes-256-gcm', '-binary', '-outform', 'DER',
             '-in', str(work / 'snapshot.tar'), '-out', str(sealed), '-recip', str(certificate)])
        sealed.chmod(0o600)
        # Only ciphertext reaches the selected drive/cloud-synced destination.
        # Exclusive creation also works on backup drives without hard links.
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, 'wb') as target, sealed.open('rb') as source:
                shutil.copyfileobj(source, target, 1024 * 1024)
                target.flush()
                os.fsync(target.fileno())
        except BaseException:
            output.unlink(missing_ok=True)
            raise
    return {'archive_sha256': digest(output), 'files': len(files),
            'storage_objects': len(manifest.get('storage', {}).get('objects', []))}


def verify(archive, key, certificate, output=None):
    with tempfile.TemporaryDirectory(prefix='haw-recovery-check-') as work:
        work = Path(work)
        run(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', str(archive),
             '-inkey', str(key), '-recip', str(certificate), '-out', str(work / 'snapshot.tar')])
        with tarfile.open(work / 'snapshot.tar') as tar:
            members = tar.getmembers()
            names = [m.name for m in members]
            if len(names) != len(set(names)) or any(not m.isfile() for m in members):
                raise ValueError('Invalid backup member inventory')
            raw = tar.extractfile('manifest.json')
            if raw is None or tar.getmember('manifest.json').size > 64 * 1024 * 1024:
                raise ValueError('Missing or oversized manifest')
            manifest = json.load(raw)
            if manifest.get('schema_version') not in (1, 2):
                raise ValueError('Unsupported recovery schema')
            files = manifest['files']
            if not {'database/roles.sql', 'database/schema.sql', 'database/data.sql'} <= set(files):
                raise ValueError('Incomplete database backup')
            if manifest.get('schema_version') == 2 and 'database/managed.sql' not in files:
                raise ValueError('Missing managed service schema')
            if manifest.get('schema_entrypoint') is not None and manifest['schema_entrypoint'] not in files:
                raise ValueError('Missing declared schema entrypoint')
            for item in manifest.get('storage', {}).get('objects', []):
                if item.get('backup_file') not in files:
                    raise ValueError('Missing Storage recovery file')
            if set(names) != set(files) | {'manifest.json'}:
                raise ValueError('Backup inventory mismatch')
            for name, expected in files.items():
                if not re.fullmatch(r'database/(?:roles|schema|managed|complete_schema|data)\.sql|storage/[0-9a-f]{64}', name):
                    raise ValueError('Unsafe backup path')
                member = tar.getmember(name)
                if member.size != expected['size']:
                    raise ValueError('Backup file size mismatch')
                h = hashlib.sha256()
                with tar.extractfile(member) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        h.update(block)
                if h.hexdigest() != expected['sha256']:
                    raise ValueError('Backup content digest mismatch')
            if output is not None:
                output = outside_repository(output)
                output.mkdir(mode=0o700, parents=False, exist_ok=False)
                # All members are regular files with validated fixed/hashed names.
                tar.extractall(output, filter='data')
        return {'verified_files': len(files), 'storage_objects': len(manifest.get('storage', {}).get('objects', [])),
                'database_replay_verified': False}


def keychain_private_key(service, account):
    if sys.platform != 'darwin':
        raise ValueError('Keychain verification requires macOS')
    # Read through the same Python/framework owner that retained the key. No
    # helper process, ACL changes, plaintext command arguments or UI prompt.
    c = ctypes
    cf = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    sec = c.CDLL('/System/Library/Frameworks/Security.framework/Security')
    pointer = c.c_void_p
    cf.CFStringCreateWithCString.argtypes = [pointer, c.c_char_p, c.c_uint32]
    cf.CFStringCreateWithCString.restype = pointer
    cf.CFDictionaryCreate.argtypes = [pointer, c.POINTER(pointer), c.POINTER(pointer), c.c_long, pointer, pointer]
    cf.CFDictionaryCreate.restype = pointer
    cf.CFDataGetLength.argtypes = [pointer]
    cf.CFDataGetLength.restype = c.c_long
    cf.CFDataGetBytePtr.argtypes = [pointer]
    cf.CFDataGetBytePtr.restype = pointer
    sec.SecItemCopyMatching.argtypes = [pointer, c.POINTER(pointer)]
    sec.SecItemCopyMatching.restype = c.c_int32
    def constant(lib, name): return pointer.in_dll(lib, name).value
    def string(value): return cf.CFStringCreateWithCString(None, value.encode(), 0x08000100)
    pairs = [
        (constant(sec, 'kSecClass'), constant(sec, 'kSecClassGenericPassword')),
        (constant(sec, 'kSecAttrService'), string(service)),
        (constant(sec, 'kSecAttrAccount'), string(account)),
        (constant(sec, 'kSecReturnData'), constant(cf, 'kCFBooleanTrue')),
        (constant(sec, 'kSecUseAuthenticationUI'), constant(sec, 'kSecUseAuthenticationUIFail')),
    ]
    query = cf.CFDictionaryCreate(None, (pointer * len(pairs))(*(k for k, _ in pairs)),
        (pointer * len(pairs))(*(v for _, v in pairs)), len(pairs),
        c.addressof(c.c_byte.in_dll(cf, 'kCFTypeDictionaryKeyCallBacks')),
        c.addressof(c.c_byte.in_dll(cf, 'kCFTypeDictionaryValueCallBacks')))
    result = pointer()
    status = sec.SecItemCopyMatching(query, c.byref(result))
    if status != 0:
        raise RuntimeError(f'Recovery Keychain item unavailable without interaction ({status})')
    return c.string_at(cf.CFDataGetBytePtr(result), cf.CFDataGetLength(result))


def verify_keychain(archive, service, account, certificate, output=None):
    value = keychain_private_key(service, account)
    if not value.startswith(b'-----BEGIN PRIVATE KEY-----'):
        raise ValueError('Selected Keychain item is not a recovery private key')
    with tempfile.TemporaryDirectory(prefix='haw-keychain-recovery-') as work:
        key = Path(work) / 'recipient.pem'
        fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(value)
        return verify(archive, key, certificate, output)


def choose_storage_key(keys, configured=None):
    key = configured or next((row.get('api_key') for row in keys
        if row.get('type') == 'secret' and row.get('name') == 'default'), None)
    if not isinstance(key, str) or not re.fullmatch(r'sb_secret_[A-Za-z0-9_-]{20,128}', key):
        raise ValueError('Provide a usable opaque server key through SUPABASE_SECRET_KEY; legacy or masked keys are not accepted')
    return key


def create(output, certificate):
    output = outside_repository(output)
    ref = (ROOT / 'supabase/.temp/project-ref').read_text().strip()
    configured = os.environ.get('SUPABASE_SECRET_KEY')
    keys = [] if configured else json.loads(run(['supabase', 'projects', 'api-keys', '--project-ref', ref, '--output', 'json'], cwd=ROOT))
    key = choose_storage_key(keys, configured)
    client = Storage(ref, key)
    initial = client.inventory()
    with tempfile.TemporaryDirectory(prefix='haw-recovery-source-') as work:
        work = Path(work)
        (work / 'database').mkdir(mode=0o700)
        (work / 'storage').mkdir(mode=0o700)
        for name, flags in [('roles', ['--role-only']), ('schema', []), ('data', ['--data-only', '--use-copy'])]:
            run(['supabase', 'db', 'dump', '--linked', '--file', str(work / 'database' / (name + '.sql')), *flags], cwd=ROOT)
        run(['supabase', 'db', 'dump', '--linked', '--schema', 'auth,storage',
             '--file', str(work / 'database/managed.sql')], cwd=ROOT)
        # Dump app and managed schemas in one pg_dump invocation as well, so
        # cross-schema triggers, foreign keys and policies have one dependency order.
        schema_text = (work / 'database/schema.sql').read_text()
        schemas = set(re.findall(r'^CREATE SCHEMA IF NOT EXISTS "([A-Za-z0-9_]+)";', schema_text, re.M))
        schemas.update(('auth', 'storage', 'public', 'private'))
        run(['supabase', 'db', 'dump', '--linked', '--schema', ','.join(sorted(schemas)),
             '--file', str(work / 'database/complete_schema.sql')], cwd=ROOT)
        for item in initial['objects']:
            blob = hashlib.sha256(json.dumps([item['bucket'], item['name']]).encode()).hexdigest()
            item['backup_file'] = 'storage/' + blob
            client.download(item, work / item['backup_file'])
        final = client.inventory()
        comparable = [{k: v for k, v in row.items() if k != 'backup_file'} for row in initial['objects']]
        if initial['buckets'] != final['buckets'] or comparable != final['objects']:
            raise ValueError('Storage changed during backup; no archive published')
        manifest = {'schema_version': 2, 'project_ref': ref,
                    'created_at': datetime.now(timezone.utc).isoformat(), 'storage': initial,
                    'backend_commit': run(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
                    'database_format': 'Supabase CLI logical roles/schema/data',
                    'schema_entrypoint': 'database/complete_schema.sql',
                    'not_included': ['Edge Function deployment artifacts', 'platform configuration and secrets']}
        return package(work, output, certificate, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    c = commands.add_parser('create')
    c.add_argument('--output', type=Path, required=True)
    c.add_argument('--certificate', type=Path, required=True)
    v = commands.add_parser('verify')
    v.add_argument('--archive', type=Path, required=True)
    key_source = v.add_mutually_exclusive_group(required=True)
    key_source.add_argument('--key', type=Path)
    key_source.add_argument('--keychain-service')
    v.add_argument('--keychain-account')
    v.add_argument('--certificate', type=Path, required=True)
    v.add_argument('--restore-files', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'create':
        result = create(args.output, args.certificate)
    elif args.keychain_service:
        if not args.keychain_account:
            parser.error('--keychain-account is required with --keychain-service')
        result = verify_keychain(args.archive, args.keychain_service, args.keychain_account, args.certificate, args.restore_files)
    else:
        result = verify(args.archive, args.key, args.certificate, args.restore_files)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
