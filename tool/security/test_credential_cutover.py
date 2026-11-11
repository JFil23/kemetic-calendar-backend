import hashlib
import json
import unittest
from pathlib import Path
from tool.security import credential_cutover as cutover

class CredentialCutoverTests(unittest.TestCase):
    def test_every_live_file_is_bound_to_immutable_evidence(self):
        manifest=json.loads((cutover.BASE/'manifest.json').read_text())
        self.assertEqual(len(manifest['functions']),42)
        self.assertEqual(len(manifest['unavailable']),9)
        for row in manifest['functions']:
            for file in row['files']:
                with self.subTest(slug=row['slug'],file=file['path']):
                    path=cutover.BASE/row['slug']/file['path']
                    self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),file['sha256'])
            result=cutover.build(row['slug'])
            self.assertEqual(result['name'],row['slug'])
            self.assertEqual(result['entrypoint_path'],row['entrypoint'])
            # No dependency can be silently dropped from a deployed function.
            names={f['name'] for f in result['files']}
            self.assertTrue({f['path'] for f in row['files']}<=names)

    def test_only_credential_reads_change(self):
        original='const key = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";\nconst data = await getPrivateRows(verifiedUser.id);\n'
        actual=cutover.replace_key_reads(original,'supabase/functions/example/index.ts')
        self.assertEqual(actual,'import { serviceSecretKey } from "../_shared/supabase_keys.ts";\nconst key = serviceSecretKey(["SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);\nconst data = await getPrivateRows(verifiedUser.id);\n')

    def test_direct_client_reads_keep_user_authorization(self):
        original='const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;\nconst client = createClient(url, publicKey, { global: { headers: { Authorization: userToken } } });\n'
        updated=cutover.replace_key_reads(original,'supabase/functions/example/index.ts')
        self.assertIn('publishableKey()',updated)
        self.assertIn('Authorization: userToken',updated)

    def test_unknown_source_cannot_be_deployed(self):
        for slug in ['resolve_share','debug_check_auth','missing','../ai_generate_flow']:
            with self.assertRaises(ValueError):cutover.build(slug)

    def test_personalization_logic_is_the_served_version(self):
        artifact=cutover.build('rebuild_personal_graph')
        body=next(f['content'] for f in artifact['files'] if f['name'].endswith('/rebuild_personal_graph/index.ts'))
        self.assertNotIn('MAAT_FLOW_COMPLETION_SOURCE_TABLE',body)
        self.assertIn('const PLANNER_BADGE_WEIGHTS',body)
        self.assertIn('client.auth.getUser()',body)

    def test_public_astronomy_gateway_not_weakened_without_handler_verifier(self):
        artifact=cutover.build('resolve_full_moon_instrument')
        self.assertFalse(artifact['verify_jwt'])
        self.assertIn('authorizePublicRequest',next(f['content'] for f in artifact['files'] if f['name']==artifact['entrypoint_path']))

if __name__=='__main__':unittest.main()
