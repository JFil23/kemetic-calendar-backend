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


## Cold CI replication readiness

The first complete remote gate at 51128f1 exposed a harness race: the channel
reported SUBSCRIBED before the server's PostgreSQL replication subscription
was ready, so the single test send was not delivered to that subscription.
The harness now awaits both the channel join and the protocol's system event
with extension=postgres_changes and status=ok before sending. The 15-second
stage deadlines, single-send delivery assertion, idempotency, unread/read,
fresh-client persistence and outsider isolation assertions are unchanged.
This is a test readiness fix, with no change to group-DM product behavior.
The pinned realtime-js 2.10.2 runtime dispatches system events through on(),
but its public TypeScript overloads omit them, so the harness declares only
that documented protocol event locally. Protocol reference:
https://supabase.com/docs/guides/realtime/protocol#system
Local evidence: /tmp/haw-group-dm-replication-ready.log.

## October 7 — Inbox message actions and first-send ownership

`send_dm_message` now creates a request-local JWT-scoped database client.
Authenticating a JWT on the former shared service client did not attach the
sender identity to writes; first-send placeholder creation failed the personal
calendar ownership trigger. Calendar membership is acknowledged before the
placeholder insert so RLS observes it in a separate statement. Ownership checks
remain intact. `inbox_first_send_runtime_smoke.ts` covers new senders and recipient
reads against real local auth/RLS, verified reply quotes, fresh-client private
hiding, sender-only unsending, and outsider denial. The full gate runs this test.

Direct and group replies store a server-resolved quote in the existing payload,
not client-authored source text. The `inbox_message_action` RPC authorizes the
actor against the message participants before hiding privately or unsending for
all participants. Private dismissals live in account-owned database rows, never
an evictable warm cache. Existing security-invoker Inbox views apply the added
RLS predicates. Group runtime coverage includes these action semantics alongside
its original member/outsider, retry, unread and Realtime checks.

Received flow forwarding extends `create_flow_share` with a readable
`source_share_id`; it reuses the immutable complete snapshot and existing delivery
pipeline. The flow runtime test verifies appearance/events after forwarding.
Local checks: 613 Deno tests, 73 source-contract tests and all three real runtime
checks passed. Local reset used the CI-pinned CLI 2.117.0; the installed 2.84.2
cannot replay a historical concurrent-index migration.

Release receipt: the full backend gate passed for source commit 3a5a3fa
(run 37700612704). The connected Supabase migration API assigned deployment
version 20261007231646; the migration filename is reconciled to that receipt
without changing its gate-tested SQL. The linked CLI read-only dry run did not
progress and was stopped before using the connected API. Function source was
uploaded from the verified backend checkout with JWT verification enabled:
send_dm_message v13, send_dm_message_v2 v2, and create_flow_share v44. Deployed
function versions are checked against the returned API receipts before final
release accounting.
