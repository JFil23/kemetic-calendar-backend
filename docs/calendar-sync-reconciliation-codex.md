# Calendar Sync Reconciliation - Implementation Codex

## Guiding principle

Notifications and sync must be derived from one final reconciled event set, not from raw stored rows independently.

Existing behavior to preserve: CID-based merge, local `deleted_cids` in Hive, load-time standalone dedupe (manual > native > holiday), delete-by-`id`/`clientEventId` + tombstone for `native:` events, settings-triggered sync and holiday seed.

---

## Phase 1 - Stop zombie notifications

Goal: No notifications for deleted, suppressed, or non-existent events. Restoration and scheduling must be driven by current visible/eligible events after sync, not by `scheduled_notifications` alone.

### 1.1 Scope

| Area | Action |
|------|--------|
| When notifications are restored | Move or gate behind sync; never reschedule all from DB without validating event existence. |
| After sync | Add a reconciliation pass: desired set from visible events -> cancel stale, schedule missing. |
| `notify.dart` | Primary file to change first. |

### 1.2 Current behavior (to change)

- `mobile/lib/features/calendar/notify.dart`
  - `Notify.init()` (around line 141) calls `rescheduleAllFromDatabase()` after plugin init.
  - `rescheduleAllFromDatabase()` loads all active future rows from `scheduled_notifications` and re-schedules them locally without checking `user_events` or suppression.
- `mobile/lib/main.dart`
  - On sign-in: `unawaited(_initNotificationsSafely())` and `unawaited(_calendarSync?.start())` run in parallel, so notifications can be restored before sync completes.

### 1.3 Implementation steps

**Step 1.1 - Filter reschedule by existing events**

- In `notify.dart`, add a helper that, given a list of `client_event_id`s, returns only those that still have a corresponding visible event in `user_events` (and optionally not suppressed).
- Options:
  - A) New RPC or Supabase query returning only IDs that exist in `user_events` (and optionally not in suppression table when Phase 2 exists).
  - B) Client-side: in `rescheduleAllFromDatabase()`, after loading notification rows, batch-fetch `user_events` by those `client_event_id`s; drop any notification whose `client_event_id` is not in the returned set.
- Implement B first (no schema change): query `user_events` for `user_id` and `client_event_id in (list from scheduled_notifications)`; only reschedule notifications whose `client_event_id` appears in the result.
- If an event row is missing (deleted), do not reschedule that notification; optionally call `_markNotificationInactive(client_event_id)` so DB state matches.

**Step 1.2 - Run notification restoration after sync (or after first load)**

- Option A - Sync triggers notification pass:
  - In `CalendarSyncService.sync()` (in `calendar_sync_service.dart`), at the end of a successful sync (inside the `try` after `_mergeSupabaseIntoNative`), call a new method such as `Notify.reconcileNotificationsAfterSync(windowStart, windowEnd)` (or pass the window the sync used). Notification state is updated only after sync has run.
- Option B - Defer init reschedule until after first sync:
  - In `main.dart`, do not call `rescheduleAllFromDatabase()` inside `Notify.init()`. Instead, have `CalendarSyncService.start()` (or the first successful `sync()` completion) invoke a one-time restore step that runs the filtered reschedule (Step 1.1) or the full reconciliation (Step 1.3).
- Prefer Option A so every sync (including manual sync) can repair notification state; keep `Notify.init()` lightweight (plugin init only), and have sync completion trigger the notification pass.

**Step 1.3 - Post-sync notification reconciliation (recommended)**

- Add `Notify.reconcileNotificationsFromEvents(...)` (or similar) that:
  - Inputs: time window (e.g. sync window) and the list of visible/eligible events in that window. Eligible = present in `user_events`, not suppressed (once Phase 2 exists), and within notification horizon (e.g. future or N days ahead).
  - Logic:
    1. Build desired set: for each eligible event, determine if it should have a notification (by existing app rules: reminder, event start, etc.) and compute `client_event_id` + scheduled time.
    2. Load from `scheduled_notifications`: active rows with `scheduled_at` in the same window.
    3. Cancel and mark inactive any scheduled notification whose `client_event_id` is not in the desired set (event was deleted or suppressed).
    4. For each desired notification that does not yet have an active scheduled row, call `scheduleAlertWithPersistence` (or internal schedule + persist).
- Who provides the visible events list?
  - A) After sync, `CalendarSyncService` calls `UserEventsRepo.getEventsForWindow(...)` again (or a dedicated events eligible for notifications query) and passes the result to `Notify.reconcileNotificationsFromEvents(...)`.
  - B) Calendar page (or a shared calendar state service) exposes the current visible set; reconciliation runs when that state is updated after sync.
- Prefer A for Phase 1: keep reconciliation inside sync + notify, and use `getEventsForWindow` (or a variant that returns only non-suppressed events). Scope for Phase 1: eligible means exists in `user_events` in the window; after Phase 2 add "and not in suppression table."

**Step 1.4 - Startup order**

- Ensure that when the app starts and the user is signed in:
  1. `Notify.init()` runs (plugin + permissions only; no full reschedule from DB).
  2. `CalendarSyncService.start()` runs and performs at least one `sync()`.
  3. On first successful `sync()` completion, run the filtered reschedule (Step 1.1) or the full reconciliation (Step 1.3). Notifications should derive from post-sync event set.
- In `main.dart`, keep `_initNotificationsSafely()` and `_calendarSync?.start()` as-is for ordering; the critical change is what runs when (filtered reschedule or reconciliation after sync, not unfiltered reschedule in init).

### 1.4 Files to touch

| File | Changes |
|------|--------|
| `mobile/lib/features/calendar/notify.dart` | Add filtered reschedule; add `reconcileNotificationsFromEvents` (or equivalent); remove or gate unfiltered `rescheduleAllFromDatabase()` from `init()`; ensure reconciliation uses existing `_markNotificationInactive` and `scheduleAlertWithPersistence`. |
| `mobile/lib/services/calendar_sync_service.dart` | At end of successful `sync()`, call Notify reconciliation (with window and event list from repo). |
| `mobile/lib/main.dart` | Optional: ensure init does not perform full reschedule; rely on sync to trigger notification pass. |

### 1.5 Validation

- Delete a note that has a future notification; restart app; run sync (or open app so sync runs). Verify no notification fires for that note.
- Disable US holidays or delete a seeded holiday that had a notification; same check.
- Confirm existing valid notifications still fire after app restart and sync.

---

## Phase 2 - Durable tombstones

Goal: "Deleted from app only" for native-synced events is remembered across devices and reinstalls. Sync must not re-import events that are in the suppression table.

### 2.1 Scope

| Area | Action |
|------|--------|
| Server | New table (e.g. `user_event_suppressions` or `calendar_suppressions`) keyed by user + identifier of the event (CID and/or external_id + source). |
| Client | On delete from app only for native events: write to Supabase suppression table; keep writing to Hive as cache. Sync: load suppressions for window and skip upserting native events that match. |
| Sync | Before upserting a native event, check suppression list (and local Hive for offline/performance). |

### 2.2 Schema (Supabase migration)

- New table, e.g. `user_event_suppressions`:
  - `id` (uuid, pk)
  - `user_id` (uuid, FK to auth.users)
  - `client_event_id` (text) - at least for native events, this is the CID we already use
  - Optional: `source_type` (text), `external_id` (text), `logical_fingerprint` (text), `suppressed_at` (timestamptz), `scope` (text: event | series for future recurring)
- Unique constraint on `(user_id, client_event_id)` (or broader if you add external_id).
- RLS: user can insert/select/delete own rows only.
- Index on `(user_id, client_event_id)` for fast lookup during sync.

### 2.3 Implementation steps

**Step 2.1 - Migration and repo**

- Add migration in `supabase/migrations/` creating the table, RLS, and index.
- In `user_events_repo.dart` (or a small `suppressions_repo.dart`): add `insertSuppression(userId, clientEventId, ...)`, `getSuppressionsForWindow(userId, startUtc, endUtc)` (or by list of CIDs), and optionally `deleteSuppression(userId, clientEventId)` for "delete from calendar too" (Phase 5).

**Step 2.2 - Sync: load suppressions**

- In `CalendarSyncService.sync()`:
  - After fetching native and Supabase events, load suppression list for the same window (by time window or by set of native CIDs). Use the new repo to get `client_event_id`s (and optionally fingerprint) that are suppressed.
  - When building the set of native events to merge, treat a native event as suppressed if its CID (or its logical fingerprint, when available) is in the suppression list or in local `_deletedCids`.

**Step 2.3 - Skip suppressed events in merge**

- In `_mergeNativeIntoSupabase`: before upserting, check both `_deletedCids.contains(cid)` and server suppression list. If suppressed, skip upsert and do not write cache for that CID as present (or leave cache as-is to avoid re-import next run).
- Keep writing to local Hive on `recordDeletedInApp` so offline behavior and performance stay good; add a call to the new Supabase insert so the server has the tombstone.

**Step 2.4 - Record tombstone on delete from app only**

- In `calendar_page.dart` (or wherever delete is handled), when the user deletes a native-synced event and the intent is app only (Phase 5 will make this explicit; current behavior is app only for native):
  - After successful `repo.delete(...)` or `repo.deleteByClientId(...)`, call `recordDeletedInApp(cid)` (existing).
  - Add a new call: e.g. `SuppressionsRepo.insertSuppression(userId, cid)` (or via `CalendarSyncService.recordDeletedInApp` which then writes both to Hive and to Supabase).
- Ensure `recordDeletedInApp` (or equivalent) is the single place that records "deleted from app only" so both Hive and Supabase stay in sync.

### 2.4 Files to touch

| File | Changes |
|------|--------|
| `supabase/migrations/` | New migration: `user_event_suppressions` table, RLS, index. |
| `mobile/lib/data/user_events_repo.dart` or new repo | CRUD for suppressions. |
| `mobile/lib/services/calendar_sync_service.dart` | Load suppressions in `sync()`; in `_mergeNativeIntoSupabase` skip when CID (or fingerprint) is in server or local suppression set; optionally extend `recordDeletedInApp` to write to Supabase. |
| `mobile/lib/features/calendar/calendar_page.dart` | After delete of native event, ensure Supabase suppression is written (via sync service or repo). |

### 2.5 Validation

- On device A, delete a native-synced event "from app only." On device B (or after reinstall), run sync. That event must not reappear in the app.
- Same device: delete, sync again; event must stay gone.

---

## Phase 3 - Write-time dedupe

Goal: Avoid creating duplicate rows for the same logical event (e.g. same holiday from native and seeded). Dedupe before insert/upsert, not only at load time.

### 3.1 Scope

| Area | Action |
|------|--------|
| Holiday seeding | Before inserting a seeded holiday, check for an existing event (same day, normalized title, all-day) with source native or same holiday; skip insert if found. |
| Native sync | Before upserting a native event, check for an existing row that is logically equivalent (same day, normalized title, all-day, same or near time); if equivalent exists and has higher or equal priority, skip or suppress. |
| Priority | Use same logical order as load-time: manual > flow/reminder > native > ics_import > holiday_seeded. |

### 3.2 Logical equivalence

- Fingerprint (reusable): same as `NativeCalendarEvent.fingerprint`: normalized title + start/end + allDay + location + description (e.g. hashed or string). For same-day checks, use canonical date (e.g. UTC date or user local date).
- Collision families:
  - `holiday_seeded` vs `native_*` (same day + normalized title + all-day)
  - `ics_import` vs `native_*` (when ICS exists)
  - `manual` vs manual (same day + title + time)
  - Native vs native (same external_id or same fingerprint)

### 3.3 Implementation steps

**Step 3.1 - Holiday seeder: check before insert**

- In `us_holiday_seeder.dart`, before `r.upsertByClientId(...)` for each holiday:
  - Query `user_events` (via repo) for the same user and same date (day boundary) and optionally same normalized title (or slug). Filter to events that are native or holiday (by `category` or future `source_type`).
  - If a row exists that matches (same day + title match or slug match), skip the insert for that holiday (or optionally update that row metadata only). This prevents a second row when the user already has "Presidents Day" from their device calendar.
- Add a repo method if needed: e.g. `existsEventOnDate(userId, date, normalizedTitleOrSlug, allDay)` or `getEventsForDay(userId, date)` and check in Dart.

**Step 3.2 - Sync: check before upserting native**

- In `_mergeNativeIntoSupabase`, before calling `_eventsRepo.upsertByClientId(...)` for a native event:
  - Compute the event's logical fingerprint (reuse or mirror `NativeCalendarEvent.fingerprint`).
  - Query (or use an in-memory set built from `supabaseEvents`) for any event in the same day with the same fingerprint (or same normalized title + all-day + same start/end minute). If such a row exists, compare source priority: if existing is `manual` or `flow`/`reminder`, do not overwrite with native (skip upsert). If existing is `holiday_seeded` and incoming is native, either skip native or replace seeded (product choice: prefer device holidays -> skip seeded insert when native exists; prefer seeded -> skip native when seeded exists). Document the choice in code.
- Use `category` (or `source_type` when added) to determine priority. Avoid creating a second row when a higher-priority equivalent already exists.

**Step 3.3 - Normalized title**

- Normalize titles for comparison: trim, lowercase, collapse whitespace; for holidays, optional slug (e.g. `presidents-day`) so "Presidents Day" variants match.

### 3.4 Files to touch

| File | Changes |
|------|--------|
| `mobile/lib/features/settings/us_holiday_seeder.dart` | Before each `upsertByClientId`, query for existing event same day (+ title/slug); skip if found. |
| `mobile/lib/data/user_events_repo.dart` | Optional: `getEventsForDay(userId, date)` or `findEquivalentEvent(userId, date, fingerprintOrTitle, allDay)` for sync and seeder. |
| `mobile/lib/services/calendar_sync_service.dart` | In `_mergeNativeIntoSupabase`, before upsert, check for equivalent event by day + fingerprint (or title + all-day + time); apply priority rule and skip or replace. |

### 3.5 Validation

- Enable US holidays, then add the same holiday (e.g. "New Year's Day") to the device calendar. Sync. Only one event should remain (either native or seeded, per product rule).
- With holidays on, run seeder twice; no duplicate rows for the same holiday.

---

## Phase 4 - Formalize source identity

Goal: Explicit `source_type` (and optionally `external_id`, `logical_fingerprint`) instead of overloading `category`. Enables consistent sync rules, dedupe, and UI badges.

### 4.1 Scope

| Area | Action |
|------|--------|
| Schema | Add `source_type` to `user_events` (and optionally `external_id`, `logical_fingerprint`). Backfill from existing `category` / CID patterns. |
| Sync | Set `source_type` when upserting (e.g. `native_ios` / `native_android`). |
| Seeders / app | Set `source_type` for manual, flow, reminder, holiday_seeded, ics_import. |
| Load/dedupe | Use `source_type` (and fingerprint when present) for priority and equivalence. |

### 4.2 Schema

- Add column: `source_type text` (nullable at first). Values: `manual`, `flow`, `reminder`, `ics_import`, `native_ios`, `native_android`, `holiday_seeded`.
- Optional: `external_id text` (native calendar event id, ICS uid, etc.), `logical_fingerprint text` (same formula as sync fingerprint).
- Migration: add columns; backfill from `client_event_id` and `category` (e.g. `native:` -> `native_ios`/`native_android` from platform, `holiday:us:` -> `holiday_seeded`, `maat:` -> `flow`, `reminder:` -> `reminder`, else `manual`).

### 4.3 Implementation steps

**Step 4.1 - Migration and backfill**

- Create migration adding `source_type` (and optional columns). Backfill via UPDATE using existing data (CID patterns, category).

**Step 4.2 - Repo and models**

- In `UserEvent` (and any DTOs), add `sourceType` (and optional `externalId`, `logicalFingerprint`). Update `fromRow`, `toInsert`, `toPatch`, and all select/upsert paths to include `source_type`.

**Step 4.3 - Sync**

- When calling `upsertByClientId` for native events, pass `source_type: 'native_ios'` or `'native_android'` (from existing platform label). When updating by id, set `source_type` if you add it to update payload.

**Step 4.4 - Seeders and creators**

- `UsHolidaySeeder`: set `source_type: 'holiday_seeded'` (and category if still used).
- Manual note creation: set `source_type: 'manual'`.
- Flow/reminder events: set `source_type: 'flow'` or `'reminder'`.
- ICS import: set `source_type: 'ics_import'` when implemented.

**Step 4.5 - Dedupe and UI**

- In load-time dedupe (`_standalonePriority`, etc.), prefer `source_type` over inferring from CID/category. In write-time dedupe (Phase 3), use `source_type` for priority. Optionally show badges (Manual, Synced, Holiday, Reminder) from `source_type`.

### 4.4 Files to touch

| File | Changes |
|------|--------|
| `supabase/migrations/` | Add `source_type` (and optional columns); backfill. |
| `mobile/lib/data/user_events_repo.dart` | Add fields to model and all queries/upserts. |
| `mobile/lib/services/calendar_sync_service.dart` | Pass `source_type` for native upserts. |
| `mobile/lib/features/settings/us_holiday_seeder.dart` | Pass `source_type: 'holiday_seeded'`. |
| `mobile/lib/features/calendar/calendar_page.dart` | Where manual/flow/reminder events are created, set `source_type`; use it in `_standalonePriority` and dedupe. |

### 4.5 Validation

- New native events have `source_type` native_*; new holidays have `holiday_seeded`; manual notes have `manual`. Load and write-time dedupe behave correctly by source.

---

## Phase 5 - Explicit delete intent (native-synced events)

Goal: User can choose "Remove from app only" vs "Remove from calendar too" for native-synced events. Use existing `deleteEvent(nativeId)` on the platform bridge.

### 5.1 Scope

| Area | Action |
|------|--------|
| UI | When deleting an event that is native-synced, show a choice: "Remove from app" vs "Remove from app and calendar" (or similar). |
| App only | Current behavior: delete row, tombstone (local + server), cancel notification; do not call platform `deleteEvent`. |
| Calendar too | Delete row, cancel notification, call `CalendarPlatformBridge.deleteEvent(nativeId)`; remove from suppression table if that event was previously app-only suppressed (so we do not leave a stale tombstone). |

### 5.2 Implementation steps

**Step 5.1 - Detect native-synced event**

- When building the delete flow, the note already has `clientEventId` (and optionally `source_type`). Treat as native-synced if `client_event_id.startsWith('native:')` or `source_type` is `native_ios`/`native_android`. You need the native calendar event id for "delete from calendar too." That is stored in Hive cache (`_SyncCacheEntry.nativeId`) or can be read from the sync service (e.g. expose `getNativeIdForCid(cid)` that reads from cache). If not in cache, "Remove from calendar too" can be disabled or best-effort.

**Step 5.2 - Delete UI**

- In the delete path (e.g. long-press or delete confirmation), if the event is native-synced, show a dialog: "Remove from app only" / "Remove from app and calendar." If not native-synced (manual, holiday, reminder), keep single "Delete" action.
- On "Remove from app only": current behavior (delete row, tombstone, cancel notification).
- On "Remove from app and calendar": delete row; cancel notification; call sync service method `deleteFromNativeCalendar(cid)` which looks up `nativeId` from cache and calls `_platform.deleteEvent(nativeId)`; remove that CID from local `_deletedCids` and from server suppressions (so sync will not treat it as suppressed anymore since the event is gone from device).

**Step 5.3 - Sync service**

- Add `deleteFromNativeCalendar(String cid)` in `CalendarSyncService`: resolve `nativeId` from Hive cache (`cid-for-native-${nativeId}` or the cache entry for this CID); call `_platform.deleteEvent(nativeId)`; then clear tombstone for this CID (remove from `_deletedCids` and persist to Hive; call suppressions repo to delete that CID from `user_event_suppressions` if present).

### 5.4 Files to touch

| File | Changes |
|------|--------|
| `mobile/lib/features/calendar/calendar_page.dart` | Delete confirmation: two options for native-synced events; call sync service for "calendar too" and pass intent to delete handler. |
| `mobile/lib/services/calendar_sync_service.dart` | Expose `getNativeIdForCid(cid)` (from cache) and `deleteFromNativeCalendar(cid)` (delete on device, clear tombstone/suppression). |
| `mobile/lib/data/user_events_repo.dart` or suppressions repo | `deleteSuppression(userId, clientEventId)` for clearing server tombstone when user chooses "calendar too." |

### 5.5 Validation

- For a native-synced event: "Remove from app only" -> event disappears from app, stays on device, does not come back after sync. "Remove from app and calendar" -> event removed from app and from device calendar; no tombstone left.

---

## Dependency order

- Phase 1 can be done immediately (notify + sync only).
- Phase 2 depends on nothing; can run in parallel with 1 or after. Phase 1 + 2 together fix zombies and cross-device resurrection.
- Phase 3 is independent; improves write-time dedupe (holidays + native). Better with Phase 4 (source_type) but can use `category` and CID patterns first.
- Phase 4 (source_type) helps Phase 3 and 5; can be done after 3 or in parallel.
- Phase 5 (delete intent) is clearer with Phase 2 (suppressions) and Phase 4 (source_type) but can be implemented with current CID + category and local cache for `nativeId`.

---

## Cursor-ready one-liner

Keep the existing CID-based sync, local tombstones, and load-time priority dedupe; then implement in this order: (1) notification reconciliation after sync and filtered reschedule so no zombies; (2) durable server tombstones and sync skips suppressed; (3) write-time dedupe for holidays and native; (4) source_type (and optional fingerprint) in schema and behavior; (5) explicit "Remove from app" vs "Remove from calendar too" for native events using the platform delete.
