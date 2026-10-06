# Inbox group-chat repair — October 6, 2026

## Cause and scope

At 2026-10-06 04:04:26 UTC, the browser OPTIONS request to
create_dm_conversation returned 404. The live project had none of
create_dm_conversation, send_dm_message_v2, or mark_dm_conversation_read.
The existing group schema was installed, but its three tables were absent
from supabase_realtime. The app already contained the picker, group route,
message reader, sender, and subscriptions.

Reuse the existing handlers from the backend main authority (base fee453d).
The only database change adds dm_conversations, dm_conversation_members,
and dm_messages to the existing publication, preserving all RLS policies.
The migration is idempotent. No app source, layout, route, warm-cache key,
resource schema, account ownership, or pending-write behavior changes.

## Verification

- Served RC receipt matched local/origin RC 1dfc71632a06428e668e34910fd3a3dadb5d777a.
- Screenshot and current ProfileSearchPage establish the existing picker;
  no visual replacement or changed app build is part of this repair.
- New publication assertion failed before the migration and passed after it.
- Fresh local replay of all 236 migrations passed. The initial reused local
  database had prior Cut 14 fixture state; clean replay resolved that gate
  precondition without changing an assertion or fixture.
- Backend code gate: 38 output-quality tests, 607 edge-function tests,
  73 source-contract tests, type/lint gates passed.
- All 27 database/concurrency gate steps passed, including the group RLS smoke.
- Real local handlers/store/auth/Realtime test passed: selected-member group
  creation, exact-participant reuse, CORS, invalid-auth rejection, sending,
  idempotent message retry, another member receiving the realtime event,
  message reads, fresh-client summaries, unread/read transitions, and outsider
  read/write rejection. Temporary local users are cleaned up; push is captured.
- RC warm-state contract and all 9 focused picker/inbox/model/repository tests
  passed. App-owned source and approved visual references remain unchanged.
- Backend CI now runs the existing group RLS smoke and the new local runtime
  smoke. Runtime invocation: supabase status -o env piped into
  deno run --allow-env --allow-net supabase/dev/group_dm_runtime_smoke.ts.
- Logs and step receipts: /private/tmp/haw-group-dm/.

## Live receipt

Project: vrbubwqapwkxxexkwkgu (shared by the existing app lanes).
All three endpoints were deployed from the backend authority, version 1,
ACTIVE, with gateway JWT verification enabled. Downloaded entrypoints and
shared dependency matched local source exactly.

Applied migration: 20261006041334_enable_group_dm_realtime.sql.
Supabase assigned the applied timestamp; the local filename was aligned to
that receipt without changing its SQL. SHA-256:
f34f0458e292d45d778629571306a228b5854a4a373a706b8f0096396c310ed3.
Live catalog confirms all three publication memberships and RLS enabled.
Each endpoint returns OPTIONS 204 with the requesting RC origin and rejects
unauthenticated POST with 401. No application deployment is required.

The real-account phone round trip and device push notification delivery have
not been exercised. No messages were sent to the user's contacts. Local
integration proves the handler/storage/realtime path; public endpoint probes
prove deployment and browser preflight/auth, not a signed-in phone session.

## Finalization — October 6

The user confirmed group DMs currently function and authorized finalizing this
pending work on backend main at e7bd70b. The local runtime replay initially
timed out while Realtime was initializing its replication connection; a replay
after initialization passed every existing assertion with no product or test
changes. Live read-only catalog inspection again confirmed all three publication
memberships. The prior complete gate receipts remain in /private/tmp/haw-group-dm.
The final runtime receipt is /tmp/haw-group-dm-finalize-retry.log.
