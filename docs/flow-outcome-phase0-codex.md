# Flow outcome Phase 0 – implementation codex

**Goal:** Implement the production-safe Phase 0 outcome backfill (honest proxies, no fake completion) and the app_events telemetry so `compute_flow_outcome` and downstream consumers can rely on real signals. This version includes the last-mile fixes (badge_count, null user_id guard, timestamp style, cron filters, telemetry gating, and sanity checks).

**Scope:** One migration (RPC), client `track()` calls in 4–5 places, cron query, and verification. No schema change to `flow_outcomes` columns.

---

## 1) Pre-checks (schema)

| Item | Check | Action |
| ---- | ----- | ------ |
| `journal_badges` | Columns `flow_id` + `occurred_on`? | If yes: count directly by `(user_id, flow_id, occurred_on)` windowed by date. If no: join to `journal_entries` by `entry_id` and window by `greg_date`; nullable/missing `entry_id` will undercount (badge_count is a lower bound until direct fields exist). |
| `flows` | Columns `is_hidden`, `is_reminder` | If present, cron can filter them out. |
| `flow_outcomes` | Partial unique `(user_id, flow_id, window_start) where window_start is not null` | RPC `ON CONFLICT` must match exactly. |

---

## 2) Database: migration with RPC

- **File:** `supabase/migrations/YYYYMMDDHHMMSS_compute_flow_outcome_rpc.sql`.
- **Function:** `compute_flow_outcome(p_flow_id bigint)` with:
  - Guard: if `user_id` is null, `return`.
  - UTC window (no string concat):  
    `v_window_start_ts := (v_window_start::timestamp at time zone 'UTC');`  
    `v_window_end_ts := ((v_window_end + 1)::timestamp at time zone 'UTC');`
  - Guarded cast for `properties->>'flow_id'`: `(ae.properties ? 'flow_id') and (ae.properties->>'flow_id') ~ '^\d+$'` before `::bigint`.
  - Telemetry gating: only `event_updated`, `event_deleted`, `flow_rescheduled`, flow-scoped (`flow_id = p_flow_id`); exclude `telemetry_enabled` from gating. `accepted_as_is` is set only when flow-scoped telemetry exists; otherwise NULL.
  - Journal: window by `greg_date` only (no `created_at`).
  - Badge count: prefer direct count on `journal_badges` by flow/date if schema allows; otherwise join to `journal_entries` and window by `greg_date` (nullable `entry_id` can undercount, so badge_count is a lower bound until direct fields exist).
  - `metadata`: `scheduled_days`, `badge_count`, `journal_days`, `schedule_density`, `edit_count`, `delete_count`, `reschedule_count`, `has_edit_telemetry`, `outcome_confidence` (`low`/`medium`).
  - `flow_outcomes.edit_count` = sum of edit + delete + reschedule counts.
  - Conflict handling must match the partial unique index:  
    `on conflict (user_id, flow_id, window_start) where (window_start is not null) do update set ...`
  - Comment on function, revoke from public, grant execute to `service_role` only.
- **Run / verify:** Apply the migration, then as `service_role` run `select compute_flow_outcome(<flow_id>);` and confirm `flow_outcomes` has correct `window_start`, `events_total`, `metadata.*`, `has_edit_telemetry`, `outcome_confidence`, and `accepted_as_is` (NULL when no telemetry).

---

## 3) Client: app_events taxonomy and constants

- Shared constant: `const String kAppEventsSchemaVersion = 'ae_v1';` (e.g., `mobile/lib/telemetry/telemetry.dart`).
- Use it in every `track()` call below (`properties['v'] = kAppEventsSchemaVersion`).
- Events:

| Event               | Meaning                                 | Required properties              |
| ------------------- | --------------------------------------- | -------------------------------- |
| `telemetry_enabled` | New telemetry schema is active          | `v`: `ae_v1`                     |
| `event_updated`     | Single event was updated                | `flow_id` (int), `event_id` uuid |
| `event_deleted`     | Single event was deleted                | `flow_id` (int), `event_id` uuid |
| `flow_rescheduled`  | Flow rescheduled (delete + schedule)    | `flow_id` (int)                  |

Always send `v: ae_v1` in `properties` for these events so the RPC can require new telemetry later if needed.

---

## 4) Emit locations (minimal set)

**telemetry_enabled (once per session)**  
- Where: Next to `app_open` (bootstrap, e.g., `main.dart`).  
- When: Once per launch/session.  
- Code: `track('telemetry_enabled', properties: { 'v': kAppEventsSchemaVersion });` (fire-and-forget).

**flow_rescheduled (once per reschedule)**  
- Where: Orchestration that does `deleteByFlowId(flowId)` then `scheduleFlowNotes(...)` (e.g., `_triggerFlowSchedule`).  
- When: After the delete call, before scheduling.  
- Code: `await repo.track('flow_rescheduled', properties: { 'flow_id': flowId, 'v': kAppEventsSchemaVersion });` (one per reschedule, not per event).
 - Optional properties for richer signals (non-blocking): `from_date` when using `deleteByFlowId(..., fromDate: ...)`; `reason` (e.g., `user_reschedule`, `import`, `edit_rules`, `timezone_fix`); `deleted_count` / `created_count` if available without extra queries.

**event_updated (single-event updates)**  
- Where: `UserEventsRepo.update()`.  
- Need: Return `flow_local_id` (via `.select().single()` or pass from caller).  
- Emit: After successful update, if `flowLocalId != null && > 0`, `track('event_updated', properties: { 'flow_id': flowLocalId, 'event_id': id, 'v': kAppEventsSchemaVersion });`.

**event_deleted (single-event deletes)**  
- Where: `UserEventsRepo.delete(String id)` (and optionally single-event `deleteByClientId`).  
- Need: Get `flow_local_id` (param or `.select()` on delete).  
- Emit: After delete, if `flowId` present, `track('event_deleted', properties: { 'flow_id': flowId, 'event_id': id, 'v': kAppEventsSchemaVersion });`.  
- Do **not** emit inside `deleteByFlowId` (bulk); covered by `flow_rescheduled`.

---

## 5) Repo changes summary

- `UserEventsRepo.update()`: Return `flow_local_id`; emit `event_updated` with `flow_id`, `event_id`, `v`.  
- `UserEventsRepo.delete()`: Capture `flow_id`; emit `event_deleted` with `flow_id`, `event_id`, `v`; optional for single-event `deleteByClientId`.  
- Scheduling orchestration: Emit `flow_rescheduled` once per reschedule (after bulk delete, before scheduling).  
- App bootstrap: Emit `telemetry_enabled` once per launch/session.

---

## 6) Cron / backfill (service_role)

- Daily query (ended flows without outcome row):  
  ```sql
  select f.id as flow_id
  from public.flows f
  left join public.flow_outcomes o
    on o.user_id = f.user_id
    and o.flow_id = f.id
    and o.window_start = f.start_date::date
  where f.end_date is not null
    and f.start_date is not null
    and (f.end_date::date) < current_date
    and coalesce(f.is_hidden, false) = false
    and coalesce(f.is_reminder, false) = false
    and o.id is null
  order by f.end_date
  limit 500;
  ```
- Helper RPC (service_role): `select * from flow_outcome_candidates(<limit>);` returns the same selection for use in Edge/cron.
- Edge function (service_role): `supabase/functions/cron_compute_flow_outcomes` calls `flow_outcome_candidates` (default limit 500) then `compute_flow_outcome` per row; expose via Supabase cron or external scheduler.
- One-off backfill: same query without `o.id is null`, rely on RPC upsert.
- For each `flow_id`, call `select compute_flow_outcome(flow_id);`.

---

## 7) Verification

- RPC: As `service_role`, run `select compute_flow_outcome(<flow_id>);` and inspect `flow_outcomes` for correct `window_start`, `events_total`, `metadata.scheduled_days`, `metadata.has_edit_telemetry`, `metadata.outcome_confidence`, `accepted_as_is` (NULL when no telemetry).  
- Telemetry: Trigger app open, one flow reschedule, one event update, one event delete; confirm `app_events` rows with `flow_id`, `event_id` (where applicable), and `v`.  
- Safety: `compute_flow_outcome` grants only to `service_role`; no grant to `authenticated`.

---

## 8) Docs / expectations

- `accepted_as_is` stays NULL until flow-scoped telemetry exists; intentional to avoid treating “no events” as “accepted.”  
- Optional future: a `flow_scheduled` app event (with `flow_id`, `v: ae_v1`) could provide flow-scoped telemetry without counting as an edit (not required for Phase 0).

---

## 9) Order of implementation

1. Schema verification (journal_badges shape, flows flags, flow_outcomes index).  
2. RPC changes (null user_id guard, UTC timestamps, journal by `greg_date`, badge count path, flow-scoped telemetry, metadata names).  
3. Deploy RPC (migration).  
4. Cron/backfill with selection query and `compute_flow_outcome`.  
5. Telemetry constant/usages and emitters (app open, reschedule, update, delete).  
6. Sanity checks (index vs ON CONFLICT, RLS), docs expectations.

---

## 10) Quick reference: what Phase 0 does and does not do

| Does | Does not |
|------|----------|
| Aggregates events_total, scheduled_days, journal_days, badge_count, edit/delete/reschedule counts | Set `events_completed` (stays NULL until Phase 1) |
| Sets `accepted_as_is` only when flow-scoped telemetry exists | Use `telemetry_enabled` to gate `accepted_as_is` |
| Windows journal/badges by **date** (greg_date / occurred_on) | Window journal/badges by `created_at` |
| Skips flows with null `user_id` | Assume every flow has user_id |
| Uses UTC timestamp bounds for app_events and user_events | Use `created_at::date` for windowing |
| Optional cron filters: is_hidden, is_reminder | Compute outcomes for hidden/reminder flows (unless filtered) |

## Client event ID stability (Phase 2a note)
- Current format (EventCidUtil): `ky={kemeticYear}-km={kemeticMonth}-kd={kemeticDay}|s={startMinutes}|t={title}|f={flowId}`. Title is part of identity; renaming breaks continuity by design.
- Stable regen: keeping `(ky, km, kd, title, startHour, startMinute, allDay, flowId)` yields the same `client_event_id`, so Phase 1 completions continue to resolve after rescheduling/re-rendering.
- Breakage: if rules/title/time/flowId change, new CIDs are generated and old completions are orphaned; do not try to “repair” completions across different flows or changed rules.
- Optional future: add a stable `event_key` (e.g., template rule id) and remove the title component so renames keep completion continuity.
