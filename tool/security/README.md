# Security hardening and recovery

This work protects existing account, sharing and release behavior. The incident
report is unverified source material; its malware attribution and destructive
cleanup instructions are not operational instructions.

## November 10 2026 changes

The five reviewed views keep their definitions. All use caller permissions.
Debug, generation analytics, ledger health and the unused legacy Inbox view are
service-only. The app continues to use `inbox_share_items_filtered`; public profile
fields and authored aggregate counts remain available. The migration changes no
account rows, storage keys, routes, policies, view columns or function bodies.

`supabase/dev/view_access_hardening_smoke.sql` exercises anonymous, owner, accepted
calendar member, unrelated account, share recipient, authenticated staff and
service roles. It preserves canonical Inbox snapshots and public profile counts.
The existing migration and sharing tests remain in the backend workflow.

The follow-up internal-RPC migration removes direct client execution from sixteen
helpers for private share payloads, worker claims, quota accounting, preferences,
flow outcomes, ledger resolution and account-wide maintenance.
The shared timezone helper retains caller access because existing invoker views
and filing reads need it; it was not swept into the internal-only set. Their definitions and owners are unchanged.
Service callers and existing checked SECURITY DEFINER entrypoints retain access.
The seven-role smoke invokes every helper to prove denial, then verifies service
snapshot/worker access and the account-owned preferences entrypoint. Real sharing,
Inbox and DM runtime checks remain mandatory in the hosted backend gate.

All GitHub Actions in the two backend workflows are pinned to upstream commits.
Workflow tokens explicitly have read-only source access. Dependency alerts, secret
scanning and push protection are enabled; dependency upgrades remain a manual
review because the authority rules prohibit creating branches. The backend
repository default branch is `main`.

Leaked-password protection is enabled in Supabase. No other auth setting changed.
The app's locked SDK tests cover existing successful sign-in with a warning,
rejected signup and rejected password update without session loss.

## Backup status and next engagement

On November 10 the platform reported eight completed daily physical database
backups, the latest at 09:39 UTC. Point-in-time recovery was not enabled. No paid
add-on, live restore, credential rotation or account deletion was performed.
Database backups exclude Storage object bytes. Actual encrypted snapshots are now
retained in `/Users/jaralephillips/Backups/kemetic-calendar/security-recovery-20261110`.
Their recipient public certificate is alongside the ciphertext. The private key
is held separately in macOS login Keychain, service `Haw encrypted recovery 2026-11-10`,
account `vrbubwqapwkxxexkwkgu`; it is never stored in this repository or backup folder.
Reopening with that retained key verified every archive file and all five Storage
objects. A local copy does not protect against device loss. Automatic approval
review blocked the proposed iCloud upload because the external destination was
not specifically authorized; no off-site copy was made.

The actual replay drill uses official image `public.ecr.aws/supabase/postgres:17.11.0.003`,
matching the live database, with `--network none`, no published ports, memory-only
`PGDATA`, and `cron.launch_active_jobs=off`. Initial failures are retained: the
bootstrap Auth schema was stale, and separate managed/app schema exports expose
cross-schema trigger and policy dependencies. The final combined schema is
exported in one pg_dump invocation so its dependency ordering is preserved.
The final `haw-20261110-complete.cms` replay passed: 186 tables and 60,928 rows
matched by row count and content, all five Storage blobs verified, and all seven
permission roles passed. Floating point fields were compared by IEEE binary value;
other COPY fields were compared exactly, preserving duplicate rows while allowing
physical row order to differ. The retained `restore-receipt.json` records hashes,
image identity and isolation. The fixture handles profiles already created by the
real Auth bootstrap trigger; no assertion was removed. Auth-service startup,
session refresh, Storage-service upload replay, platform/integration secret
restoration and off-site retention remain unverified.

Use the existing authenticated Supabase CLI, Docker and OpenSSL 3. Storage
access uses a usable opaque server secret key (`SUPABASE_SECRET_KEY` in the
invoking process; the CLI can supply it only when it reveals the actual value).
The older local CLI masks opaque secrets. Masked values and
legacy keys are rejected and are never added as a new recovery dependency.
Use the credential store or authenticated Management API to supply the opaque key
only in process memory; never paste it into chat, shell arguments or source. The wrapper
uses supported roles/schema/data and explicit managed-schema exports, retains a
combined schema entrypoint for replay, downloads every Storage object,
checks that the Storage inventory remained stable, records SHA-256 digests and
seals the archive with CMS AES-256-GCM. Plain staging data is confined to a private
temporary directory. The wrapper's CLI and service credentials stay in memory and are not added to
the manifest or logs. Database data may contain stored integration credentials
and other confidential account content; the entire archive is encrypted.
The archive is never committed to a repository. Existing files are not overwritten.

To verify the retained snapshot without knowing or copying a key, run this from
the backend checkout on this Mac:

```sh
python3 tool/security/recovery.py verify \
  --archive /Users/jaralephillips/Backups/kemetic-calendar/security-recovery-20261110/haw-20261110-complete.cms \
  --certificate /Users/jaralephillips/Backups/kemetic-calendar/security-recovery-20261110/recipient-public.pem \
  --keychain-service 'Haw encrypted recovery 2026-11-10' \
  --keychain-account vrbubwqapwkxxexkwkgu
```

This checks archive integrity only and deliberately reports database replay as
false. The separate successful drill receipt proves the observed database replay.
The command reads the existing Keychain item without changing its access controls
or prompting for its value, and removes its private temporary key file afterward.
Losing this Mac and its Keychain can still lose the ability to decrypt these copies.

For a future snapshot at an authorized destination with a separately retained key:

```sh
python3 tool/security/recovery.py create \
  --output /CHOSEN_BACKUP_DESTINATION/haw-YYYYMMDD.cms \
  --certificate /EXISTING_KEY_LOCATION/recipient.pem
python3 tool/security/recovery.py verify \
  --archive /CHOSEN_BACKUP_DESTINATION/haw-YYYYMMDD.cms \
  --certificate /EXISTING_KEY_LOCATION/recipient.pem \
  --key /EXISTING_KEY_LOCATION/private-key.pem
```

`verify --restore-files /NEW_PRIVATE_DIRECTORY` additionally recovers logical SQL
and hashed Storage blobs into a new private directory. Names and bucket metadata
are in its manifest. Verification checks all digests and rejects extra files,
links, path traversal, malformed inventories and corrupted ciphertext. It never
connects to a database or uploads to Storage.

Database replay must be a separately observed drill in an isolated Supabase
environment matching the platform versions, with outbound traffic, schedulers,
mail and push disabled. Use the supported Supabase roles/schema/data restoration
procedure, then verify account row counts, representative content, RLS boundaries
and every Storage blob. Preserve failures; do not omit tables or assertions to
make a restore pass. The November local stack uses older service versions and is
not a valid target for a live production-data recovery claim.

Sources: [Supabase restore procedure](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[backup scope](https://supabase.com/docs/guides/platform/backups).

## Verification commands

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest supabase.tests.test_source_contracts tool.security.test_recovery
```

The complete exact-source hosted backend gate must pass before applying the
migration to the linked project. A deployment receipt must link the candidate
commit, successful gate run, migration digest and post-deployment permission/
view-definition readback. No app build or deployment is needed for these backend
and CI changes. App deployments remain subject to their own exact-lane full gate.
