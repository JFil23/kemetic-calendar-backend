# ḥꜣw Admin / Operator Console Roadmap

Version: 2.0 execution summary

Last updated: 2026-05-18

## Current Baseline

Done locally:

- `docs/admin/`: Phase 0 inventory, ADR-001 through ADR-004, and intentional behavior guardrails.
- `supabase/migrations/20260518090000_admin_console_phase1.sql`.
- `supabase/functions/admin_auth` with Deno tests.
- `admin/` Vite + React shell, Supabase auth gate, full navigation placeholders.
- `.github/workflows/admin.yml` and `admin/src` service-role guard.

Not done until production bootstrap:

- Apply the Phase 1 migration.
- Deploy `admin_auth`.
- Insert founder row in `staff_members`.
- Configure `admin/.env`.
- Verify owner login reaches Product Overview without 403.
- Optionally regenerate `db/schema.sql` if the repo release process requires a fresh schema snapshot.

## Phase Order

```text
P1 closure / bootstrap
  -> P2 Read-only War Room
  -> P3 Ops agent runtime skeleton
  -> P4 Research + Copy agents
  -> P5 Social + Suggest Updates + Product QA + Chief Operator
  -> P6 Ma'at ops
  -> P6 Node CMS after source-of-truth decision
```

Use one phase per PR unless a later explicit instruction says otherwise.

## Phase 1 Closure

Purpose: make the secure shell deployable and understandable.

Deliverables:

- `admin/README.md`
- documented migration apply/deploy/bootstrap flow
- optional `db/schema.sql` sync only if repo policy requires it

No Phase 2 features belong here.

## Phase 2: Read-Only War Room

Purpose: first real productivity win, with app health and Ma'at signals without SQL.

Build:

- `admin_war_room_summary(p_days int)` RPC.
- `admin_war_room` Edge Function.
- `/war-room/dashboard` UI with 7d/30d/90d range, KPI cards, Ma'at table, nodes, flows, errors, and honest empty states.
- Deno authorization tests.

Rules:

- Require `war_room.read`.
- Log `war_room.view` to `admin_audit_log`.
- Aggregate only; no raw journal/reflection content.
- Browser never queries sensitive tables directly.
- Respect `telemetry_enabled` and `personalization_enabled`.
- Do not create a parallel `analytics_events` table.

## Phase 3: Agent Runtime Skeleton

Purpose: shared infrastructure only, with an echo/stub run.

Tables:

- `ops_agent_definitions`
- `ops_jobs`
- `ops_runs`
- `ops_run_outputs`
- `haw_archive_entries`
- `haw_armory_playbooks`
- `haw_approval_requests`
- `haw_treasury_ledger`
- `haw_treasury_budgets`
- `codex_tasks`
- `suggestions`

Seed only:

- `research`
- `social`
- `copy`
- `suggest_updates`
- `product_qa`
- `chief_operator`

Edge Functions:

- `admin_archive`
- `admin_armory`
- `admin_approvals`
- `admin_treasury`
- `admin_agent_run`

No external APIs or real LLM calls in CI.

## Phase 4: Research + Copy

Purpose: first useful draft agents.

Research output:

- Archive entry in `namespace: research`
- cited brief
- implications and next actions

Copy output:

- Archive entry in `namespace: copy`
- variants A/B/C
- recommended choice and notes

No production content mutation.

## Phase 5: Remaining Four Agents

Social:

- draft-only
- no posting APIs
- manual posting approval only

Suggest Updates:

- requires Phase 2 War Room
- writes `suggestions` plus Archive summary

Product QA:

- writes `codex_tasks`
- includes copy-ready Codex prompt

Chief Operator:

- weekly report to Archive and War Room card
- recommends but never approves

Optional:

- Media Bay only if social draft assets are needed.

## Phase 6: Ma'at Ops And Node CMS

Do not start until Phases 2-5 are stable and the War Room is being used weekly.

Ma'at ops first:

- fixture browser
- policy version display
- delivery inspector with support scope and audit
- dry-run evaluate/replay
- routing override drafts with approval

Node CMS after ADR-002 is resolved:

- current interim is Option C: Dart remains app-visible canonical source
- admin may create drafts only until DB fetch or codegen pipeline exists
- do not claim published DB node content is live in the app until the pipeline exists

## Never Do

- Embed admin in `mobile/`.
- Put service role secrets in `admin/src`.
- Broaden authenticated SELECT on `app_events`, Ma'at tables, journals, or private user content.
- Create `analytics_events` parallel to `app_events` without an ADR.
- Create `library_nodes` parallel to `public.nodes` without an ADR and migration plan.
- Add out-of-scope agent rooms such as DJ, POD, supplements, trading, commerce, or game assets.
- Add autonomous posting, PR creation, publishing, trading, ad buying, or production content mutation.
- Build a full Ma'at graph canvas in early phases.
