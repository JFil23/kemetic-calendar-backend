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
Database backups exclude Storage object bytes. A retained encrypted copy and an
actual production-snapshot restore drill still require a chosen destination and
encryption certificate. Do not describe archive integrity tests as a successful
production database restore.

Use the existing authenticated Supabase CLI, Docker and OpenSSL 3. Storage
access uses the existing opaque server secret key (or `SUPABASE_SECRET_KEY`);
legacy keys are rejected and are never added as a new recovery dependency. The wrapper
uses the supported roles/schema/data exports, downloads every Storage object,
checks that the Storage inventory remained stable, records SHA-256 digests and
seals the archive with CMS AES-256-GCM. Plain staging data is confined to a private
temporary directory. The wrapper's CLI and service credentials stay in memory and are not added to
the manifest or logs. Database data may contain stored integration credentials
and other confidential account content; the entire archive is encrypted.
The archive is never committed to a repository. Existing files are not overwritten.

After choosing an existing off-site or backup-drive destination and an encryption
certificate whose private key is held separately:

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
