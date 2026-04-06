# Phase 4 guardrails and operational policy

This document records the Phase 4 guardrails so we can ship learning safely without changing Phase 0–3 behavior.

## Status
Phase 4 guardrails are implemented end-to-end (constraint injection with kill switch, user controls, cache purge).

- Implemented: get_recent_outcome_vectors, deriveConstraintsV1 (capacity/performance split), constraint-to-prompt injection with DM_USE_CONSTRAINTS gate and cache fingerprinting, personalization off (Edge + cron), telemetry off flag (profile + client gate), 90-day cache purge.
- Optional follow-ups: surface UI to toggle telemetry/personalization and keep wiring in sync across clients.

## Flow generation logging semantics
- One `flow_generation_logs` row per invocation (success **and** failure). Cache hits still create a fresh row with a new `generation_id`.
- Cache tables never store `generation_id`; each request calls `crypto.randomUUID()` for its own `generation_id`.
- If cache-hit sampling is ever added, document it alongside a field such as `served_from_cache` (or a `log_sampled` flag) so log volume and semantics stay explicit.

## Telemetry off vs personalization off
- **Telemetry off**: Stop or minimize inserts into `app_events` (edits, feedback, imports, etc.). `compute_flow_outcome` can still run; edit/feedback fields may be null or absent.
- **Personalization off**: Do not store new `flow_outcomes` for this user (or exclude them from cron selection) and do not feed their outcomes into generation. Generation should skip `get_recent_outcome_vectors` for these users.
- Schema and toggle plumbing are a follow-up; this document defines the behavior so Edge functions/cron can implement the flags consistently.

## Generation data sources
- `ai_generate_flow` must **not** read directly from `app_events`. It may read `flow_outcomes` (via the RPC below), `flows` (origin fields), and optionally `flow_generation_logs` for recent constraints. Phase 2a signals should be consumed only after they are aggregated into outcomes.

## Outcome vector source of truth
- The canonical source for `ov_v1` vectors inside the app is the RPC `get_recent_outcome_vectors(p_user_id uuid, p_limit integer)`, which joins `flow_outcomes` and `flows` and returns versioned JSON objects.

## Cache retention
- `flow_generation_cache` contains user data. Retain entries for at most 90 days for lookup; add a scheduled purge that deletes rows where `created_at < now() - interval '90 days'`. Cache lookups already restrict to the past 7 days; the purge aligns storage/privacy with that runtime window.

## Client event identity (CID) behavior
- Current CID format (`EventCidUtil`): `ky={kemeticYear}-km={kemeticMonth}-kd={kemeticDay}|s={startMinutes}|t={title}|f={flowId}`.
- Title changes intentionally produce a new CID, which orphans completions for the previous title. Optional future mitigation: add a stable `event_key` (e.g., template rule id) and remove title from the identity so renames keep continuity.
