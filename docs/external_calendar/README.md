# External calendar projection contract

This implementation is new code on the verified app/backend baseline. Prior
failed calendar implementations are not implementation dependencies. Imported
calendars never write authored event storage, auth settings, reminders, flow
filing, or personal-calendar ownership.

## Ownership

- Backend repository `main` owns this schema and Edge Function.
- `external_calendar_events_v1` contains disposable imported projections only.
  Authenticated users can select their rows but cannot insert/update/delete.
- Every connection, OAuth attempt, source and request has an explicit `staging`
  or `production` lane. No lane default exists. Each app reads only its own
  projection lane; imported copies remain separate from authored calendar rows.
- Google credentials, provider subject, selected sources, leases and diagnostic
  counts live in private tables. Only a service-role RPC can mutate them.
- Device sources have a separate connection, one explicit owning device, and a
  separate apply function. Native payloads cannot write Google-owned sources.
- Google and device sources can coexist. `google_bindings` explicitly assigns a
  device source to Google ownership, removes its native projection, and excludes
  it from device snapshots. No global event-title/UID heuristic deduplicates
  unrelated calendars. Ownership remains Google even if the linked Google source
  later disappears; it never silently falls back to native import.

## Google request contract

POST `/functions/v1/external_calendar`, authenticated with the existing Hꜣw user
JWT. The JSON body always includes `action` and `lane`.

| Action | Additional fields | Result |
| --- | --- | --- |
| `status` | none | Status below; no provider requests |
| `connect` | `return_target: web\|native` (default web) | `authorization_url` |
| `sources` | none | Complete paginated calendar catalog + status |
| `select_sources` | `source_ids: UUID[]`, `expected_revision` | Status |
| `pause`, `resume`, `disconnect` | `expected_revision` | Status |
| `refresh` | optional ISO `start`, `end`, IANA `time_zone` | Status + `changed` |

Status is `{available, connection, sources, syncing, retry_at, imported_event_count}`. Connection is null
or `{id, provider:google, account_label, status, automatic, revision,
last_synced_at, error_code}`. Status values are `connected`, `paused`, or
`reconnect_required`. Each source has `{id,label,selected,color,read_only:true,
last_synced_at,error_code,imported_event_count}`. Counts are computed from confirmed
projection rows using existing connection/source indexes, not another counter
store. Sources always exist as an array. Failure bodies are
`{error:{code,retryable}}` with a corresponding non-200 HTTP status.

Google consent selects **zero calendars**. Only explicitly selected calendars
are imported. A non-catalog claim or apply with no selected sources fails with
`no_calendars_selected`; it cannot update `last_synced_at` or record a completed
import. Hidden Google calendars remain available to select. Pause retains
copies and stops scheduled imports. An explicit Import now request can refresh
once while leaving the connection paused; its lease is still invalidated by any
subsequent pause, resume, selection change or disconnect. Deselect removes only
that source's copies. Disconnect deletes only this
lane's connection, encrypted credentials and projections, invalidating in-flight
work; it does **not** revoke project-wide Google grants or modify Hꜣw sign-in.

OAuth uses separate calendar consent, server-held client credentials, one-use
random state, PKCE, and an authenticated Hꜣw account/lane binding. The callback
never creates or changes a Hꜣw session. It verifies the immutable Google OIDC
`sub` using Google's HTTPS userinfo endpoint. A different Google account is
rejected until an explicit disconnect. Tokens are AES-256-GCM encrypted with
account/lane additional authenticated data. Refresh-token rotation is preserved.
Healthy existing grants omit forced consent and use the stored immutable subject
as `login_hint`. First connections and revoked grants request consent for offline
access. A missing refresh token in a repeat authorization exchange may reuse the
existing token only for the same account, lane, connection and generation; revoked
grants never supply fallback credentials. The callback still checks scopes and
immutable identity before storing anything. Reconnecting preserves source choices
and the user's automatic-import setting. Google and OS permission requirements
remain in force.

The callback only redirects to a fixed URL:

- web: the lane's canonical origin + `/#/settings?external_calendar=<result>`
- native: `maat://calendar-import?lane=<lane>&result=<result>`

Results contain no auth code or token. The return target is stored inside the
one-use encrypted OAuth request; callback URL parameters cannot replace it.

## Native request contract

The same authenticated endpoint accepts `device_status`, `device_connect`,
`device_select_sources`, `device_snapshot`, `device_pause`, `device_resume`, and
`device_disconnect`, and `device_remove_source`. The function dispatches these to a separate service-only
RPC; it derives user ID from the validated user JWT, never a payload field.

- Native mutations supply `device_id` and, for an existing connection,
  `expected_revision`. `device_status` is readable from another device.
- `device_connect` supplies `sources: [{native_id,label,account_label,kind,color}]`.
  A new connection starts paused with nothing selected. Refreshing the same
  owner's source inventory preserves selection; absent calendars become
  unavailable and retain prior copies. Another device must explicitly send
  `replace_device:true` with the acknowledged revision to take ownership.
- `device_select_sources` supplies backend `source_ids` and optional
  `google_bindings: {native_source_UUID: Google_source_UUID}`. Bindings must refer
  to this account and lane. Deselecting/remapping deletes only affected device
  copies.
- `device_snapshot` supplies `start`, `end`, and a complete exact set of selected,
  device-owned `sources: [{id,events:[...]}]`. A paused connection accepts this
  only with `manual:true`; resume follows a successful first import. Every
  snapshot increments the revision, fencing concurrent/late results.
- Events contain `provider_event_id`, `recurrence_id` (single or original
  occurrence identity), `title`, `detail`, `location`, `all_day`, `starts_at`,
  `ends_at`, `start_date`, `end_date`. Preserve actual instants and separate civil
  dates; the end date is exclusive. Stable native identity is the source + series
  ID + original occurrence identity, not the occurrence's moved start.
- Permission denial, incomplete queries and unavailable selected calendars must
  stop before applying a snapshot. Server validation rejects incomplete source
  sets and preserves previous data.

Native status is `{available:true,connection,sources}`. Connection is null or
`{id,provider:device,owner_device_id,status,revision,automatic,last_synced_at}`.
Sources include `{id,native_id,label,account_label,kind,color,selected,available,
owned_by,google_source_id,last_synced_at}`.

## Read boundary and dates

`read_external_calendar_events_v1(p_lane,p_from,p_until)` is a security-invoker
RPC, requiring the signed-in account. It returns renderer rows with
`client_event_id=external:<uuid>`, `provider`, `source_id`, provider identity,
`title`, `detail`, `location`, `all_day`, UTC instants, independent civil dates,
`calendar_name`, and `color`. The app marks these rows read-only. Imported rows
must never enter authored-event mutation, upload, reminder or filing paths.

Google expands recurring instances server-side with `singleEvents=true`.
`event.id` is the stable occurrence identity; original recurrence time is retained
separately. Snapshots fetch every page before a single database transaction
upserts occurrences and removes missing copies inside the covered window. Empty
pages with `nextPageToken` are not completion. Any page, identity, deadline or
validation failure preserves the prior projection. Date-only query padding
covers timezone offsets; date-only rendering uses stored civil dates.

## Recovery and scheduling

A request has a 90-second total deadline, individual provider/database requests
have 10-second deadlines, and database statements have a 10-second limit. A
120-second lease prevents concurrent Google refreshes. Generation, lease and
selected-source-set checks reject a late worker after disconnect, pause,
reconnect or selection changes. Credential and OAuth callback actions are also
fenced. Calls that ignore an abort cannot continue to apply a later result.

The default refresh range is 30 days past to 180 days future. Explicit visible
ranges are at most 730 days. Limits are 50 selected calendars, 50,000 events,
100 provider pages per source, 250 events per page, and 5,000 discovered sources. Provider responses are limited to 8 MiB and the complete normalized snapshot to 20 MiB. Native snapshot/catalog bodies
are limited to 20 MiB; other actions to 16 KiB. Limit failures preserve existing
copies rather than presenting partial success.

A new dedicated cron job checks for due connections each minute. Successful
connections refresh every 15 minutes. Retryable failure backs off up to an hour;
revoked credentials require reconnect. A worker handles at most five due
connections per lane, interleaves lanes, and runs at most two imports concurrently
within its total deadline. A subsequent tick can reclaim an expired lease.
Diagnostic rows contain counts and stable error categories, not event content or
tokens, and expire after 30 days. OAuth state expires after 10 minutes.

## Configuration and rollout

No hosted setup was performed by writing this implementation. Before deployment:

1. Run the full backend gate and App gate. Validate a separate test account and
   provider test calendar, including real expired access-token refresh,
   reconnect, account mismatch, revocation, source selection, recurrence changes,
   deletion, offline recovery, and a session-preserving cold/warm app launch.
2. Enable Google Calendar API in the intended Google project. Create dedicated
   Web OAuth clients for each lane. Register exactly
   `https://<supabase-project>/functions/v1/external_calendar/callback` as the
   callback. Request only `openid`, `email`, `calendar.events.readonly`, and
   `calendar.calendarlist.readonly` (the latter two full Google scope URLs).
3. Set `EXTERNAL_CALENDAR_GOOGLE_STAGING_CLIENT_ID`,
   `EXTERNAL_CALENDAR_GOOGLE_STAGING_CLIENT_SECRET`; configure the analogous
   `PRODUCTION` pair only for an approved production release. Existing app sign-in
   clients and redirect settings remain unchanged.
4. Set `EXTERNAL_CALENDAR_CREDENTIAL_KEY` to a fresh random 32-byte base64 value.
   It is a backend encryption secret, not an app define. Preserve it across
   releases; replacing it without a credential migration requires reconnect.
5. Set `EXTERNAL_CALENDAR_WORKER_SECRET` and mirror it into Vault under
   `external_calendar_worker_secret`. Existing `project_url` supplies the
   scheduler URL. The added schedule is inert while this dedicated Vault secret
   is absent. Verify the configured schedule actually completes; merely creating
   it is not proof of background freshness.
6. Deploy `external_calendar` with platform JWT verification disabled because its
   callback and worker have different authenticators. Every user POST still
   verifies the supplied JWT at `/auth/v1/user`; callback checks one-use state;
   worker requires the dedicated constant-time-compared secret. Never expose the
   service key or encryption key in app configuration.
7. Verify Google production publishing requirements separately. Google Testing
   mode calendar refresh grants expire after seven days; a successful test is
   not proof of long-lived production authorization. Physical iPhone calendar
   permission, query behavior and native callback acceptance remain device tests.

The migration only adds fresh tables/functions/schedule and changes no existing
application or auth table. Local proof applies the migration and its smoke test
inside a rolled-back transaction against the existing disposable backend DB.
The smoke test includes an actual authored event and compares its complete row
checksum before/after, as well as account/lane/source/lease/provider fences.

## References

- [Google events and pagination](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Google calendar catalog](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server?hl=en)
- [Google immutable OIDC identity](https://developers.google.com/identity/openid-connect/openid-connect)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions)


## October 10, 2026 repair candidate and Google review

`20261010223059_calendar_import_setup_and_consent.sql` replaces the existing
`external_calendar_service_v1` owner; it adds no tables, RPCs, jobs, caches or
credential stores. Apply it before deploying the updated `external_calendar`
function, then release the RC app through its existing gate. Both service versions
remain compatible with either response shape during that sequence. Production
release needs its own exact-source gate and explicit cutover.

Inspection of Google project `maat-473006` on October 10 confirmed:

- Audience is already External / In production. Do not switch back to Testing.
- Branding already uses Hꜣw and `https://haw-info.pages.dev/`, with `/privacy` and
  `/terms`. The existing site contains its Search Console verification meta tag.
- Search Console reports Jarale Phillips as a verified owner of the same URL
  property, added October 2. Do not create another site or domain authority.
- After explicit user approval, branding re-verification was submitted on
  October 10. Google displayed “Verification in progress” and then returned the
  same homepage-ownership rejection for `https://haw-info.pages.dev/`.
  The submission is confirmed; branding approval is not. Google's additional
  review option remains available to resolve the ownership discrepancy.
- Sensitive-scope verification is blocked in Google's UI until branding is verified
  and published. Passing code tests does not remove Google's warning or user cap.

For the subsequent sensitive-scope request, the existing implementation requires
only `openid`, `email`, `calendar.events.readonly` (read selected event details)
and `calendar.calendarlist.readonly` (show available calendars for explicit
selection). A review demonstration must show connection, those read-only scopes,
source selection, imported copies, pause and disconnect. Use a dedicated fixture
account/calendar; do not upload a user's personal calendar recording. Reuse the
existing public privacy/terms links and project. Never claim Google's approval
until its verification receipt exists.

## Imported calendars in the Calendars sheet

The existing Google `select_sources` mutation removes a selected source without
provider calls. The additive `device_remove_source` action takes `source_id` and
`expected_revision` and removes only that selected device-owned import. The
verified account and explicit lane own this operation; no native device identity
or OS permission is needed to stop importing. It never changes native ownership,
other selections, Google bindings, automatic-import preferences, or authored rows.
The existing device RPC serializes removal with snapshots and increments its
generation so a late native snapshot cannot restore deleted copies. Repeating
removal at the current revision is harmless. Old-revision writes still fail.

Deploy the migration before the updated Edge Function, then qualify/deploy the
app candidate. The change is additive for older apps. An app pointed at the old
backend retains the row and reports failure for unsupported phone removal; it
never pretends that removal succeeded. Rollback of the app/Edge Function can leave
the additive migration in place. Earlier calendar consent/count changes in this
checkout remain a separate, not-yet-deployed change set.
