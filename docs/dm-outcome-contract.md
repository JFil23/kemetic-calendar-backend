# DM / UKG outcome contract (Phase 1 → ov_v1)

Phase 1 adds real completions to `flow_outcomes`/`metadata`. DM/UKG consume a versioned outcome vector so the prompt and downstream tools avoid freestyling on raw tables. The canonical in-app source for these vectors is the RPC `get_recent_outcome_vectors(p_user_id uuid, p_limit integer)` (Phase 4), which joins `flow_outcomes` and `flows` and emits `ov_v1` JSONB rows.

## Outcome vector v1 (`ov_v1`)
- `vector_version`: `"ov_v1"`.
- Identity: `window_start`, `window_end`, `flow_id`, `origin_type` (`"ai"` | `"user"`), `origin_generation_id` (nullable).
- Core metrics (derived from `flow_outcomes` + `metadata`): `schedule_density`, `journal_density`, `events_total`, `events_completed`, `completion_ratio`, `badge_rate`, `badge_count`, `edit_count`, `edit_pressure`, `accepted_as_is`.
- Confidence and caveats: `outcome_confidence` (`low` | `medium` | `high`), `lower_bounds` flags (e.g. `edit_count`, `badge_count`).
- Sample size fields: `events_total`, `events_completed`, `journal_days`, `badge_count`, `scheduled_days`, `n_days` (window length).

## Null + lower-bound semantics
- `accepted_as_is === null` means “unknown” (no flow-scoped edit telemetry), not `false`.
- `completion_ratio` is `events_completed / events_total`; when `events_total === 0`, set `completion_ratio` to `null` (do not coerce to 0).
- `edit_count` and `badge_count` are lower bounds; keep `lower_bounds` flags true for these fields.
- Use `n_days` and `events_total` as the minimum sample-size context before applying strong preferences.

## Confidence tiers
- **high**: `events_completed >= 2` **and** `completion_ratio >= 0.60`.
- **medium**: otherwise, if edit telemetry exists or there is at least one completion.
- **low**: no edits observed and zero completions.

## Interpretation guidelines
- When confidence is **low**, use observational language and avoid strong “always” claims.
- When confidence is **medium** or **high**, reference completion and edit patterns but avoid absolutes when the ratio is borderline.
