#!/usr/bin/env python3
"""Encrypted Supabase logical/database and Storage backup; offline file verification.

Credentials stay in process memory. This tool never uploads or restores a database.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
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
        url = '/object/authenticated/' + urllib.parse.quote(item['bucket'], safe='') + '/' + urllib.parse.quote(item['name'], safe='/')
        with self.request(url) as response, path.open('xb') as output:
            for block in iter(lambda: response.read(1024 * 1024), b''):
                output.write(block)


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
            for item in manifest.get('storage', {}).get('objects', []):
                if item.get('backup_file') not in files:
                    raise ValueError('Missing Storage recovery file')
            if set(names) != set(files) | {'manifest.json'}:
                raise ValueError('Backup inventory mismatch')
            for name, expected in files.items():
                if not re.fullmatch(r'database/(?:roles|schema|managed|data)\.sql|storage/[0-9a-f]{64}', name):
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
    v.add_argument('--key', type=Path, required=True)
    v.add_argument('--certificate', type=Path, required=True)
    v.add_argument('--restore-files', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'create':
        result = create(args.output, args.certificate)
    else:
        result = verify(args.archive, args.key, args.certificate, args.restore_files)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
