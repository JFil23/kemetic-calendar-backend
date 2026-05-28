# Phase 0 Schema Inventory

Date: 2026-05-18

Scope: Phase 0 inventory for the private ḥꜣw Admin / Operator Console. This file documents what exists before the admin shell work and the constraints Phase 1 must preserve.

## Repository Boundary

- Root repo: `/Users/jaralephillips/dev/kemetic-calendar`.
- Consumer app: `mobile/` is a nested Git working tree with its own `.git` directory and `main...origin/main` state.
- Phase 1 must not modify `mobile/` behavior.
- Admin target: new `admin/` Vite + React + TypeScript app in the root repo.

## Migration And Schema Snapshot

- Canonical migration history lives under `supabase/migrations/`.
- `db/schema.sql` is a generated-style schema snapshot. It already contains recent Ma'at guidance tables/views through the 2026-05-17 migration set, but the file had local uncommitted changes before this admin work started.
- No repo policy document was found that requires hand-editing `db/schema.sql` on every migration.
- Phase 1 adds a migration only. Regenerate `db/schema.sql` from the applied database after this migration if this repo's release process requires a fresh schema dump.

## Existing User And Profile Surfaces

- `profiles` stores user-facing profile data, timezone, email, discoverability settings, avatar glyphs, and telemetry/personalization flags.
- `auth.users` remains the identity source.
- Public profile RLS is broad in current schema for user-facing discovery. Admin RBAC must not reuse `profiles` or add `profiles.is_admin`.
- Existing profile helper functions include `_get_user_timezone`, `_is_personalization_enabled`, `get_my_telemetry_and_personalization`, profile feed/count RPCs, and update triggers.

## Existing Analytics And Events

- `app_events` stores client telemetry with `user_id`, `email`, `event`, `properties`, and `source`.
- RLS currently allows authenticated users to insert/select their own rows and service role access for backend diagnostics.
- `user_choice_events` stores product-choice events such as node opens, flow/reflection actions, checklist actions, suggestion actions, and Ma'at correction actions.
- Phase 2 War Room should aggregate from these sources through `admin_war_room`; the browser admin app should not query these tables directly.

## Existing Nodes And Source Split

There is a real source-of-truth split:

- Flutter/Dart source: `mobile/lib/features/nodes/kemetic_node_library.dart` contains rich node bodies, aliases, glyphs, and embedded links used by the app.
- Supabase source: `public.nodes` and `public.node_links` are created by `20260422093000_kemetic_nodes_graph.sql`.
- Seed source: `supabase/seeds/20260422093000_kemetic_nodes_seed.sql` seeds a smaller, condensed graph with much shorter body text.

Current implication: an admin Node CMS must not publish directly to app-visible content until ADR-002 is resolved. Phase 1 does not build node editing.

## Existing Journal And Badge Surfaces

- `journal_entries` and `journal_badges` are owner-scoped tables with RLS.
- Nutrition/alignment planner work also writes `nutrition_items`, `alignment_notes`, checklist/todo/rhythm tables, and journal badge-derived signals.
- Admin defaults must not show raw journal entries, private notes, or personal reflections.

## Existing Flows And Sharing Surfaces

- `flows`, `user_events`, `flow_posts`, `flow_saves`, `event_shares`, `flow_shares`, `shared_calendars`, and `shared_calendar_members` form the calendar/flow/sharing backbone.
- There are multiple guard, reconciliation, deletion, and filing RPCs/views around flow/event lifecycle.
- Internal filing views exist under `private` and service-role-only grants. Admin diagnostics should use privileged functions, not broad client grants.

## Existing Ma'at Guidance And Observability

Recent Ma'at tables/views are present in `db/schema.sql` and migrations:

- `maat_snapshots`
- `maat_guidance_deliveries`
- `maat_corrections`
- `maat_guidance_evaluations`
- `maat_band_transitions`
- `maat_user_baselines`
- `maat_flow_briefs`
- `maat_guidance_drift_outcomes`
- `maat_guidance_drift_outcome_summary`
- `maat_guidance_drift_outcome_flags`
- `maat_guidance_drift_outcome_flags_user`
- `maat_guidance_drift_outcome_flags_cohort`
- `maat_guidance_drift_outcome_dashboard`
- `maat_guidance_ops_alerts`

Phase 2 should reuse these read-only aggregate views where possible. Phase 1 must not add Ma'at editing or routing controls.

## Existing Edge Function Patterns

Relevant patterns:

- `delete_account` verifies a user JWT with a service role client and uses a JSON/CORS helper.
- `track_choice_event` verifies the caller and writes user-choice events.
- `evaluate_maat_guidance` exposes a `create...Handler` shape that is easy to unit test with a mock Supabase client.

Phase 1 `admin_auth` follows the same server-side verification pattern and adds staff lookup plus `admin_audit_log`.

## Existing Audit

- Existing `audit_log` is row-level mutation audit for app data.
- Phase 1 adds `admin_audit_log` as a separate operator audit stream.
- The two streams should stay separate: row mutation history is not the same as operator access, approvals, or future agent actions.

## Blockers And Follow-Ups

- Bootstrap owner cannot be inferred in migration. The first owner row must be inserted deliberately after deployment.
- `supabase/config.toml` is ignored in this repo. Deploy `admin_auth` with manual JWT verification behavior documented in deployment notes; the function itself validates tokens.
- Root `.gitignore` now keeps local docs ignored by default but explicitly allows `docs/admin/*` so admin ADRs and roadmap docs can be committed normally.
- Phase 2 needs a fresh pass over event naming before final KPI definitions.
