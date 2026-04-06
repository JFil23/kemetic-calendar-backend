# Flow outcome Phase 1 — completion spec (production-safe)

**Goal:** Add durable completion tracking keyed by `client_event_id` + `completed_on`, update the RPC to count completions, and define confidence rules that avoid “one tap = high confidence.” Reschedule/regeneration is handled by using stable client_event_id identities.

---

## 1) Completion storage (`user_event_completions`)

- Table: `user_event_completions` with columns `user_id`, `client_event_id`, `flow_id`, `completed_on` (date), `completed_at` (timestamptz, default now), `source`, `metadata`.
- Unique: `(user_id, client_event_id)`; index on `(flow_id, completed_on)`.
- RLS: own CRUD policies; `user_id` scoped.
- Trigger `user_event_completions_validate_insert`: on insert, require a `user_events` row for `(user_id, client_event_id, flow_local_id = flow_id)`. Validation is insert-time only so completions survive reschedule (when the event row is later deleted).
- Optional RPC `record_event_completion(client_event_id, flow_id, completed_on, source default 'client')`: validates ownership and upserts on `(user_id, client_event_id)`. Granted to `authenticated`.
- Comment notes: keyed by `client_event_id` to survive reschedule; `completed_on` is the day the completion counts for; `completed_at` is audit.

Client write path:
- Inputs: `client_event_id`, `flow_id`, event date.
- `completed_on`: the event’s scheduled date (client authoritative).
- Upsert: `insert ... on conflict (user_id, client_event_id) do update set completed_on/completed_at/source`. Undo = delete row by `(user_id, client_event_id)`.

Identity caveat:
- Keep deterministic, stable `client_event_id` for flow-backed events so regen reuses the same CID. If CIDs change on regen, you’ll see duplicate logical completions (one per CID).

---

## 2) RPC: `compute_flow_outcome` (Phase 1)

- Counts `events_completed` from `user_event_completions` where `(user_id, flow_id)` and `completed_on between window_start and window_end`.
- Adds `completed_days` and `completion_ratio = events_completed / events_total`.
- Confidence:
  - **high** when `events_total > 0` and completion coverage is strong (`events_completed >= 2` **and** `completion_ratio >= 0.6`). Avoids “single tap → high.”
  - **medium** when any completion exists but doesn’t meet “high,” or when flow-scoped telemetry exists (edits/deletes/reschedules) with no completions.
  - **low** otherwise.
- `accepted_as_is` remains set only when flow-scoped telemetry exists (same as Phase 0).
- Metadata includes: `scheduled_days`, `badge_count` (lower bound until direct flow_id/occurred_on), `journal_days`, `schedule_density`, `events_completed`, `completed_days`, `completion_ratio`, edit/delete/reschedule counts, `has_edit_telemetry`, `outcome_confidence`.
- Conflict clause unchanged: `on conflict (user_id, flow_id, window_start) where (window_start is not null) do update ...`.

---

## 3) Reschedule / regeneration behavior

- Completions are keyed by `client_event_id`; when a flow is deleted+regenerated, the new `user_events` row has the same `client_event_id`, so completions remain valid.
- Validation occurs only on insert. After reschedule, the original `user_events` row may be gone; the completion stays and is still counted by `(flow_id, completed_on)`.
- Do **not** key completions by `event_id` if you want them to survive reschedule.

---

## 4) Outcome contract notes (DM/UKG)

- Completion metrics to surface:
  - `completion_ratio`, `events_completed`, `completed_days`.
  - `edit_pressure` remains a lower bound (edits/deletes/reschedules).
  - `schedule_density` / `journal_density` / `badge_rate` as in Phase 0 (badge_count lower bound).
- Confidence guidance:
  - Use `outcome_confidence` (`low`/`medium`/`high`) from the RPC.
  - `high` only when completion coverage meets the threshold; a single completion should not imply “done.”
  - When confidence is `low`, use cautious language; when `medium`, you may reference completion/edit signals; `high` reserved for coverage passing the threshold.

---

## 5) Minimal Phase 1 scope (ship-first set)

1. Migration adding `user_event_completions`, trigger, optional RPC.
2. RPC update (completion counting + confidence rules).
3. Client path to record/undo completions (single-event “Done”), using `client_event_id`, `flow_id`, `completed_on`.
4. No bulk “complete all” until single-event and reschedule behavior are validated.
