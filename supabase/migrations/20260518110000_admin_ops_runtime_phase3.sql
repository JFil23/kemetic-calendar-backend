-- Admin / Operator Console - Phase 3
-- Ops agent runtime skeleton, draft infrastructure, and echo-only seeds.

create or replace function public.set_admin_runtime_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.ops_agent_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  status text not null default 'manual'
    check (status in ('inactive', 'manual', 'scheduled', 'disabled')),
  default_model text not null default 'echo-stub',
  required_scopes text[] not null default '{}',
  risk_level text not null default 'low'
    check (risk_level in ('low', 'medium', 'high', 'restricted')),
  tools_allowed jsonb not null default '[]'::jsonb,
  tools_blocked jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_jobs (
  id uuid primary key default gen_random_uuid(),
  agent_slug text not null references public.ops_agent_definitions(slug),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  requested_by uuid references auth.users(id),
  input jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ops_jobs(id) on delete cascade,
  agent_slug text not null references public.ops_agent_definitions(slug),
  status text not null default 'running'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  model text not null default 'echo-stub',
  created_by uuid references auth.users(id),
  input jsonb not null default '{}'::jsonb,
  output_summary text,
  error text,
  duration_ms integer,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.haw_archive_entries (
  id uuid primary key default gen_random_uuid(),
  namespace text not null
    check (namespace in (
      'research',
      'copy',
      'social',
      'suggestions',
      'codex',
      'chief_report',
      'brand',
      'technical',
      'source_notes',
      'ops'
    )),
  title text not null,
  content_md text not null,
  tags text[] not null default '{}',
  source_run_id uuid references public.ops_runs(id) on delete set null,
  source_type text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_run_outputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ops_runs(id) on delete cascade,
  output_type text not null default 'archive_entry',
  content_md text,
  payload jsonb not null default '{}'::jsonb,
  archive_entry_id uuid references public.haw_archive_entries(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.haw_armory_playbooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  agent_slug text references public.ops_agent_definitions(slug),
  version integer not null default 1,
  name text not null,
  system_prompt_md text not null,
  tools_allowed jsonb not null default '[]'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.haw_approval_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'approved',
      'rejected',
      'needs_changes',
      'cancelled'
    )),
  risk_level text not null default 'low'
    check (risk_level in ('low', 'medium', 'high', 'restricted')),
  payload jsonb not null default '{}'::jsonb,
  summary text not null,
  requested_by uuid references auth.users(id),
  requested_from_run_id uuid references public.ops_runs(id) on delete set null,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.haw_treasury_ledger (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ops_runs(id) on delete set null,
  agent_slug text references public.ops_agent_definitions(slug),
  provider text not null default 'stub',
  model text not null default 'echo-stub',
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  duration_ms integer,
  budget_period text not null default to_char(timezone('utc', now()), 'YYYY-MM'),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.haw_treasury_budgets (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'agent_slug')),
  agent_slug text references public.ops_agent_definitions(slug),
  period text not null check (period in ('daily', 'weekly', 'monthly')),
  limit_usd numeric(12, 2) not null check (limit_usd >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (scope = 'global' and agent_slug is null)
    or (scope = 'agent_slug' and agent_slug is not null)
  )
);

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  evidence jsonb not null default '{}'::jsonb,
  recommended_action text not null,
  expected_impact text,
  related_metric text,
  linked_archive_entry_id uuid references public.haw_archive_entries(id) on delete set null,
  source_run_id uuid references public.ops_runs(id) on delete set null,
  status text not null default 'new'
    check (status in ('new', 'triaged', 'approved', 'done', 'wontfix')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.codex_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'in_progress', 'completed', 'cancelled')),
  spec_md text not null,
  prompt_md text,
  source_run_id uuid references public.ops_runs(id) on delete set null,
  source_suggestion_id uuid references public.suggestions(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ops_jobs_agent_status_idx
  on public.ops_jobs(agent_slug, status, created_at desc);
create index if not exists ops_runs_agent_status_idx
  on public.ops_runs(agent_slug, status, created_at desc);
create index if not exists ops_run_outputs_run_idx
  on public.ops_run_outputs(run_id, created_at desc);
create index if not exists haw_archive_entries_namespace_idx
  on public.haw_archive_entries(namespace, created_at desc);
create index if not exists haw_archive_entries_tags_idx
  on public.haw_archive_entries using gin(tags);
create index if not exists haw_archive_entries_search_idx
  on public.haw_archive_entries using gin (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_md, ''))
  );
create index if not exists haw_armory_playbooks_agent_active_idx
  on public.haw_armory_playbooks(agent_slug, is_active, slug);
create index if not exists haw_approval_requests_status_idx
  on public.haw_approval_requests(status, created_at desc);
create index if not exists haw_treasury_ledger_agent_period_idx
  on public.haw_treasury_ledger(agent_slug, budget_period, created_at desc);
create index if not exists haw_treasury_budgets_active_idx
  on public.haw_treasury_budgets(is_active, scope, agent_slug, period);
create index if not exists suggestions_status_priority_idx
  on public.suggestions(status, priority, created_at desc);
create index if not exists codex_tasks_status_idx
  on public.codex_tasks(status, created_at desc);

drop trigger if exists set_ops_agent_definitions_updated_at on public.ops_agent_definitions;
create trigger set_ops_agent_definitions_updated_at
before update on public.ops_agent_definitions
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_ops_jobs_updated_at on public.ops_jobs;
create trigger set_ops_jobs_updated_at
before update on public.ops_jobs
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_ops_runs_updated_at on public.ops_runs;
create trigger set_ops_runs_updated_at
before update on public.ops_runs
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_haw_archive_entries_updated_at on public.haw_archive_entries;
create trigger set_haw_archive_entries_updated_at
before update on public.haw_archive_entries
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_haw_armory_playbooks_updated_at on public.haw_armory_playbooks;
create trigger set_haw_armory_playbooks_updated_at
before update on public.haw_armory_playbooks
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_haw_approval_requests_updated_at on public.haw_approval_requests;
create trigger set_haw_approval_requests_updated_at
before update on public.haw_approval_requests
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_haw_treasury_budgets_updated_at on public.haw_treasury_budgets;
create trigger set_haw_treasury_budgets_updated_at
before update on public.haw_treasury_budgets
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_suggestions_updated_at on public.suggestions;
create trigger set_suggestions_updated_at
before update on public.suggestions
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_codex_tasks_updated_at on public.codex_tasks;
create trigger set_codex_tasks_updated_at
before update on public.codex_tasks
for each row execute function public.set_admin_runtime_updated_at();

alter table public.ops_agent_definitions enable row level security;
alter table public.ops_jobs enable row level security;
alter table public.ops_runs enable row level security;
alter table public.ops_run_outputs enable row level security;
alter table public.haw_archive_entries enable row level security;
alter table public.haw_armory_playbooks enable row level security;
alter table public.haw_approval_requests enable row level security;
alter table public.haw_treasury_ledger enable row level security;
alter table public.haw_treasury_budgets enable row level security;
alter table public.codex_tasks enable row level security;
alter table public.suggestions enable row level security;

revoke all on table public.ops_agent_definitions from anon, authenticated;
revoke all on table public.ops_jobs from anon, authenticated;
revoke all on table public.ops_runs from anon, authenticated;
revoke all on table public.ops_run_outputs from anon, authenticated;
revoke all on table public.haw_archive_entries from anon, authenticated;
revoke all on table public.haw_armory_playbooks from anon, authenticated;
revoke all on table public.haw_approval_requests from anon, authenticated;
revoke all on table public.haw_treasury_ledger from anon, authenticated;
revoke all on table public.haw_treasury_budgets from anon, authenticated;
revoke all on table public.codex_tasks from anon, authenticated;
revoke all on table public.suggestions from anon, authenticated;

grant all on table public.ops_agent_definitions to service_role;
grant all on table public.ops_jobs to service_role;
grant all on table public.ops_runs to service_role;
grant all on table public.ops_run_outputs to service_role;
grant all on table public.haw_archive_entries to service_role;
grant all on table public.haw_armory_playbooks to service_role;
grant all on table public.haw_approval_requests to service_role;
grant all on table public.haw_treasury_ledger to service_role;
grant all on table public.haw_treasury_budgets to service_role;
grant all on table public.codex_tasks to service_role;
grant all on table public.suggestions to service_role;

insert into public.ops_agent_definitions (
  slug,
  name,
  description,
  status,
  default_model,
  required_scopes,
  risk_level,
  tools_allowed,
  tools_blocked
) values
  (
    'research',
    'Research',
    'Draft research briefs and source summaries into Archive.',
    'manual',
    'echo-stub',
    array['ops.run', 'archive.write'],
    'low',
    '["archive_read", "war_room_aggregate_read", "user_provided_documents"]'::jsonb,
    '["raw_user_data", "production_writes", "external_posting"]'::jsonb
  ),
  (
    'social',
    'Social',
    'Draft manual-post social content; never posts through APIs.',
    'manual',
    'echo-stub',
    array['ops.run', 'archive.write'],
    'medium',
    '["archive_read", "armory_read"]'::jsonb,
    '["social_posting_apis", "production_writes", "raw_user_data"]'::jsonb
  ),
  (
    'copy',
    'Copy',
    'Draft copy variants for app, store, support, and onboarding surfaces.',
    'manual',
    'echo-stub',
    array['ops.run', 'archive.write'],
    'low',
    '["archive_read", "armory_read"]'::jsonb,
    '["production_content_mutation", "node_publish", "raw_user_data"]'::jsonb
  ),
  (
    'suggest_updates',
    'Suggest Updates',
    'Draft product and content suggestions from War Room aggregates.',
    'manual',
    'echo-stub',
    array['ops.run', 'war_room.read'],
    'medium',
    '["war_room_aggregate_read", "archive_write"]'::jsonb,
    '["production_writes", "raw_user_data", "node_publish"]'::jsonb
  ),
  (
    'product_qa',
    'Product QA',
    'Draft Codex-ready bug and feature specs.',
    'manual',
    'echo-stub',
    array['ops.run'],
    'medium',
    '["archive_read", "codex_task_draft"]'::jsonb,
    '["auto_pr", "deploy", "production_writes"]'::jsonb
  ),
  (
    'chief_operator',
    'Chief Operator',
    'Draft weekly operating reports and recommendations.',
    'manual',
    'echo-stub',
    array['ops.run', 'war_room.read'],
    'medium',
    '["war_room_aggregate_read", "archive_read", "treasury_read"]'::jsonb,
    '["approval_decision", "production_writes", "external_actions"]'::jsonb
  )
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    default_model = excluded.default_model,
    required_scopes = excluded.required_scopes,
    risk_level = excluded.risk_level,
    tools_allowed = excluded.tools_allowed,
    tools_blocked = excluded.tools_blocked,
    updated_at = timezone('utc', now());

insert into public.haw_armory_playbooks (
  slug,
  agent_slug,
  version,
  name,
  system_prompt_md,
  tools_allowed,
  output_schema,
  requires_approval
) values
  (
    'brand-voice-v1',
    null,
    1,
    'Brand Voice v1',
    $md$Use clear, calm, operator-first language. Favor practical usefulness over decorative mysticism. Treat all public-facing output as draft-only until approved.$md$,
    '["archive_read"]'::jsonb,
    '{"type":"markdown"}'::jsonb,
    true
  ),
  (
    'research-v1',
    'research',
    1,
    'Research v1',
    $md$Create cited research briefs with summary, key findings, implications, risks, open questions, and recommended next action. Do not store raw PII.$md$,
    '["web_research_later", "archive_read", "armory_read"]'::jsonb,
    '{"sections":["summary","key_findings","sources","implications","risks","next_actions"]}'::jsonb,
    false
  ),
  (
    'copy-v1',
    'copy',
    1,
    'Copy v1',
    $md$Create copy variants A, B, and C with a recommendation and notes. Do not mutate production app content.$md$,
    '["archive_read", "armory_read"]'::jsonb,
    '{"variants":["A","B","C"],"requires_recommendation":true}'::jsonb,
    true
  ),
  (
    'social-draft-only-v1',
    'social',
    1,
    'Social Draft Only v1',
    $md$Create social drafts for manual founder posting only. Never call posting APIs or schedule posts.$md$,
    '["archive_read", "armory_read"]'::jsonb,
    '{"draft_only":true}'::jsonb,
    true
  ),
  (
    'suggest-updates-v1',
    'suggest_updates',
    1,
    'Suggest Updates v1',
    $md$Use War Room aggregates to draft product, content, onboarding, retention, bug, and analytics-gap suggestions. Evidence must be aggregate-safe.$md$,
    '["war_room_aggregate_read", "archive_write"]'::jsonb,
    '{"writes":["suggestions","archive_summary"]}'::jsonb,
    true
  ),
  (
    'codex-task-v1',
    'product_qa',
    1,
    'Codex Task v1',
    $md$Convert observations into Codex-ready markdown specs with summary, context, expected behavior, likely files, constraints, acceptance criteria, and out-of-scope.$md$,
    '["archive_read", "codex_task_draft"]'::jsonb,
    '{"format":"codex_task_markdown"}'::jsonb,
    true
  ),
  (
    'chief-operator-v1',
    'chief_operator',
    1,
    'Chief Operator v1',
    $md$Draft weekly operating briefs with wins, risks, metric changes, pending approvals, top three actions, what to ignore, and one suggested Codex task.$md$,
    '["war_room_aggregate_read", "archive_read", "treasury_read"]'::jsonb,
    '{"format":"weekly_report"}'::jsonb,
    false
  )
on conflict (slug) do update
set agent_slug = excluded.agent_slug,
    version = excluded.version,
    name = excluded.name,
    system_prompt_md = excluded.system_prompt_md,
    tools_allowed = excluded.tools_allowed,
    output_schema = excluded.output_schema,
    requires_approval = excluded.requires_approval,
    is_active = true,
    updated_at = timezone('utc', now());
