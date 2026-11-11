"""Build credential-only function uploads from immutable live-source evidence.

This is a one-time migration, not a second feature implementation. Every original
file must match its receipt. Only the shared key-reader substitution is permitted;
all original handlers and dependencies are retained. The public computation also
gets an explicit request verifier before its legacy gateway is removed. Future feature releases use
supabase/functions as usual. Credentials never enter this module's output.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'tool/security/function_baselines/20261111'
SERVICE_READS = [
    (r'Deno\.env\.get\("SERVICE_ROLE_KEY"\)\s*\?\?\s*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)(?:\s*\?\?\s*""|!)?', 'serviceSecretKey(["SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"])'),
    (r'Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)\s*\?\?\s*Deno\.env\.get\("SERVICE_ROLE_KEY"\)(?:\s*\?\?\s*""|!)?', 'serviceSecretKey()'),
    (r'Deno\.env\.get\(\s*"SUPABASE_SERVICE_ROLE_KEY",?\s*\)(?:\s*\?\?\s*""|!)?', 'serviceSecretKey()'),
    (r'Deno\.env\.get\(\s*"SERVICE_ROLE_KEY",?\s*\)(?:\s*\?\?\s*""|!)?', 'serviceSecretKey()'),
    (r'requireEnv\(\s*"SUPABASE_SERVICE_ROLE_KEY",\s*"SERVICE_ROLE_KEY",?\s*\)', 'serviceSecretKey()'),
]

def replace_key_reads(content: str, name: str) -> str:
    updated = content
    names = []
    for pattern, replacement in SERVICE_READS:
        updated, count = re.subn(pattern, replacement, updated)
        if count and 'serviceSecretKey' not in names:
            names.append('serviceSecretKey')
    updated, count = re.subn(r'Deno\.env\.get\("SUPABASE_ANON_KEY"\)(?:!|\s*\?\?\s*"")?', 'publishableKey()', updated)
    if count:
        names.append('publishableKey')
    if names:
        module = './supabase_keys.ts' if '/_shared/' in name else '../_shared/supabase_keys.ts'
        lines = updated.splitlines(keepends=True)
        at = 1 if lines and lines[0].startswith('// deno-lint-ignore-file') else 0
        lines.insert(at, 'import { '+', '.join(names)+' } from "'+module+'";\n')
        updated = ''.join(lines)
    return updated

def build(slug: str) -> dict:
    manifest = json.loads((BASE / 'manifest.json').read_text())
    row = next((x for x in manifest['functions'] if x['slug'] == slug), None)
    if row is None:
        raise ValueError('No verified deployed source for '+slug)
    files = {}
    for entry in row['files']:
        name = entry['path']
        path = BASE / slug / name
        if not path.resolve().is_relative_to(BASE.resolve()) or path.is_symlink():
            raise ValueError('Unsafe baseline path')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError('Deployed source changed: '+name)
        files[name] = replace_key_reads(raw.decode(), name) if path.suffix == '.ts' else raw.decode()
    key_owner = 'supabase/functions/_shared/supabase_keys.ts'
    files[key_owner] = (ROOT / key_owner).read_text()
    # These handlers already perform Auth.getUser or checked staff authorization.
    # Only this reviewed set may move off the legacy-only JWT gateway.
    verified_users = {
        'create_flow_share','send_dm_message','schedule_decan_reflection',
        'respond_to_event_invite','create_event_share','fetch_maat_guidance_pending',
        'ack_maat_guidance','ensure_user_guidance','admin_maat_ops','admin_maat_dry_run',
        'record_delivery_receipt','get_delivery_receipt_status','rebuild_personal_graph',
        'generate_reflection_profile','notify_shared_calendar_item_added','admin_activity',
        'track_choice_event','create_dm_conversation','send_dm_message_v2',
        'mark_dm_conversation_read','delete_account',
    }
    if slug == 'resolve_full_moon_instrument':
        name = row['entrypoint']
        old = """    // Supabase's gateway verifies this JWT by default. Requiring the header
    // here also fails closed if the handler is ever invoked outside the gateway.
    if (!request.headers.get("authorization")?.startsWith("Bearer ")) {"""
        new = """    const publicKey = publishableKey();
    const allowed = await authorizePublicRequest(request, publicKey, serviceSecretKey(), async (token) => {
      const response = await fetch(Deno.env.get("SUPABASE_URL") + "/auth/v1/user", {
        headers: { apikey: publicKey, Authorization: "Bearer " + token },
      });
      if (!response.ok) return null;
      const user = await response.json();
      return typeof user.id === "string" ? { id: user.id } : null;
    });
    if (!allowed) {"""
        if files[name].count(old) != 1:
            raise ValueError('Unrecognized public-computation authorization boundary')
        files[name] = ('import { authorizePublicRequest } from "../_shared/public_request_authorization.ts";\n'
            'import { publishableKey, serviceSecretKey } from "../_shared/supabase_keys.ts";\n'
            + files[name].replace(old, new))
        for helper in ['public_request_authorization.ts', 'account_context_authorization.ts']:
            path = 'supabase/functions/_shared/' + helper
            files[path] = (ROOT / path).read_text()
    verify_jwt = row['verify_jwt']
    if slug == 'resolve_full_moon_instrument':
        verify_jwt = False
    if slug in verified_users:
        if not any('getUser' in text for text in files.values()):
            raise ValueError('Missing reviewed user verifier')
        verify_jwt = False
    result = {'project_id':manifest['project_ref'], 'name':slug,
        'entrypoint_path':row['entrypoint'], 'verify_jwt':verify_jwt,
        'files':[{'name':name,'content':content} for name,content in sorted(files.items())]}
    if row.get('import_map'):
        result['import_map_path'] = row['import_map']
    return result

def inventory() -> list[dict]:
    manifest = json.loads((BASE/'manifest.json').read_text())
    result = []
    for row in manifest['functions']:
        artifact = build(row['slug'])
        result.append({'slug':row['slug'], 'baseline_version':row['version'],
            'verify_jwt':artifact['verify_jwt'],
            'files':[{'name':f['name'], 'sha256':hashlib.sha256(f['content'].encode()).hexdigest()} for f in artifact['files']]})
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--function')
    args = parser.parse_args()
    print(json.dumps(build(args.function) if args.function else inventory(), indent=2))
