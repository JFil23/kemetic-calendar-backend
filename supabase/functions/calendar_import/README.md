# One-way calendar import

External calendars are the content authority. HAw imports into existing
`user_events` and never writes calendar events to Google, EventKit, or Android.
The app candidate is developed only in the app-only RC checkout. This backend
change does not grant app release authority.

## Ownership and compatibility

`calendar_import_connections` holds account/provider connections and encrypted
Google credentials. It has RLS enabled and no anonymous/authenticated table
access. `calendar_import_oauth_states` contains only hashed, expiring,
single-use OAuth state. Only the server can access credentials or OAuth state.

`calendar_import_control` and `calendar_import_apply` are invoker wrappers over
private, explicitly granted functions with an empty search path. Each private
function checks `auth.uid()`. A connection generation fences pause/disconnect; a
refresh ID rejects an older concurrent response. Apply is one transaction:
validate a complete snapshot, upsert external content regardless of HAw's
`updated_at`, then prune missing occurrences only in that connection/window.
Other connections and ordinary HAw rows are untouched. Imported deletes use the
existing audit mechanism without client suppression. v2 row IDs contain the
server-generated connection UUID; occurrence keys do not contain event titles.

Legacy provider-prefixed projections are retired in a covered interval only
after their complete replacement succeeds. Unlink also clears the matching
legacy provider projection. Existing Hive namespaces and ordinary event
suppression behavior remain unchanged. The new read-only trigger applies only to
v2 import rows, leaving served clients' existing authored mutations intact.

## Google authorization

Calendar connection is separate from HAw authentication. The initial request is
authenticated as the HAw user; a hashed OAuth state binds the callback to that
account and connection generation. Only these scopes are requested:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`

The callback exchanges the code on the server, checks the granted scopes, and
stores tokens with AES-256-GCM. Neither provider tokens nor OAuth codes are
returned to app routes. Callback origins are an explicit RC/production
allowlist. Browser requests cannot supply arbitrary redirect URIs. A
server-owned pending initial-import flag survives a callback returning in a
different Safari/PWA context; successful apply or explicit pause clears it. All
POST actions verify the HAw access token; the GET callback verifies and consumes
OAuth state.

Required backend secrets (never place in app/public build configuration):

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `CALENDAR_IMPORT_ENCRYPTION_KEY`: base64 of 32 cryptographically random bytes

Exact registered callback:
`https://vrbubwqapwkxxexkwkgu.supabase.co/functions/v1/calendar_import`

The dedicated OAuth web client belongs to the existing `maat-473006` Google
project for RC testing. Inspection on October 1 found that project's audience in
Testing, with the owner's account already a test user; calendar scopes were not
configured. Do not alter the existing HAw sign-in client. Production publication
is a separate step requiring completed Google branding/verification and
appropriate policy pages. Do not claim public availability from a test grant.

Deploy the function with `--no-verify-jwt`, because Google's GET callback does
not carry a HAw JWT. This is not an unauthenticated POST endpoint: the handler
verifies every POST access token with Supabase Auth and validates GET OAuth
state. The additive migration must pass the backend gate and be applied before
the RC app depends on these RPCs. Keep credentials out of logs and deployment
artifacts.

## Synchronization method

The initial implementation uses fully paginated, bounded snapshots, reusing the
recovered July 2 Google importer flow. It deliberately does not combine
`syncToken` with changing `timeMin`/`timeMax` parameters (Google forbids that).
A failed calendar/page aborts the entire fetch; it never becomes an empty
successful snapshot. Automatic refresh runs while the app is active, catches up
on resume, and includes the visible calendar interval beyond startup coverage.
It does not promise server-side background refresh while a PWA is suspended.
Push channels and persistent incremental cursors are future optimizations, not
hidden dependencies for the current one-way contract.

Recurring Google occurrences use calendar ID + recurringEventId +
originalStartTime. Non-recurring events use calendar ID + event ID. All-day
source dates are converted with the requesting app's IANA time zone, preserving
an exclusive end date and daylight-saving transitions. Timed offsets are
retained.

Native device calendars are separate sources. EventKit and Android bridge code
lives in the app repository; the backend accepts their complete snapshots
through the same account-fenced RPC. Physical device permission/recurrence tests
remain necessary; compiling native code is not proof of those behaviors.

## Verification

- `deno test --allow-env supabase/functions/calendar_import`
- `deno check supabase/functions/calendar_import/index.ts`
- `deno lint supabase/functions/calendar_import`
- `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/dev/calendar_import_smoke.sql`
- Complete backend function tests and existing backend source contracts.
- Real Google consent, external create/edit/move/delete, pause/reopen/reconnect,
  and a physical iPhone/Android import before claiming end-to-end success.

Primary references:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://support.apple.com/en-us/121539
