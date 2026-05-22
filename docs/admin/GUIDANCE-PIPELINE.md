# Guidance Pipeline

This pipeline keeps guidance eligibility and creation on the server. Mobile should
trigger server work and display pending deliveries; it should not implement
Ma'at, Isfet, opening, or reflection gates.

## Current Entry Points

- `ensure_user_guidance`: authenticated mobile/server facade. It schedules current
  and next decan reflection rows, ensures the current decan opening, and evaluates
  current Ma'at guidance.
- `schedule_decan_reflection`: authenticated reflection schedule writer.
- `cron_maat_decan_opening`: opening creator. Cron may call it with a cron secret;
  authenticated clients should reach it through `ensure_user_guidance`.
- `evaluate_maat_guidance`: Ma'at/Isfet evaluator and delivery creator.
- `cron_evaluate_maat_guidance`: cron-secret batch evaluator. It pages through
  profiles and evaluates users at a target local hour, defaulting to midnight.
- `fetch_maat_guidance_pending`: display selection only.
- `admin_maat_ops?action=evaluations`: support lookup for recent evaluation
  decisions by user.

## Debug Fields

`evaluate_maat_guidance` returns:

- `local_date`
- `decan_day_index`
- `period_key`
- `created`
- `suppressed`
- `drift_decision`
- `strength_decision`
- `evaluation.id`

`ensure_user_guidance` returns:

- `success`
- `timezone`
- `local_date`
- `current_period_key`
- `scheduled_windows`
- `reflection_schedule`
- `opening`
- `evaluation`

If `ensure_user_guidance.success` is false, inspect the child result with
`ok: false`. A `502` from `ensure_user_guidance` means at least one child
function failed; successful child calls are still reported in the response.

## Duplicate Prevention

The first safety layer is deterministic business identity:

- reflection schedule: `user_id + decan_start`
- opening/strength delivery: `user_id + decan_period_key` partial unique indexes
- drift delivery: policy cap plus insert/update trigger coordination
- snapshot: `user_id + window_date + decan_period_key`

Use upserts/unique constraints before adding heavier locking. Add RPC/advisory
locking only if staging data shows split writes or duplicate races.

## Content Grounding

User-specific grounding is handled by shared helpers:

- `_shared/guidance_evidence.ts` extracts short, safe evidence phrases from
  badges or evidence lines.
- `_shared/user_memory_brief.ts` builds a compact memory brief from recent
  evidence, reflection profile anchors, active tensions, decan context, and the
  current Ma'at snapshot.

Reflections receive the memory brief in the user prompt. Opening, drift, and
strength drafts receive the same memory object and may include one or two recent
evidence phrases when available. Sparse users should still get usable copy
without invented specificity.
