-- Phase 3: decision logging and state (flow_generation_logs)
alter table public.flow_generation_logs
  add column if not exists range_start date,
  add column if not exists range_end date,
  add column if not exists snapshot_version text,
  add column if not exists prompt_fingerprint text,
  add column if not exists served_from_cache boolean not null default false,
  add column if not exists constraints_json jsonb,
  add column if not exists state_snapshot jsonb,
  add column if not exists dm_policy_version text,
  add column if not exists context_summary text,
  add column if not exists input_meta jsonb;

-- Helpful indexes (optional but recommended)
create index if not exists flow_generation_logs_user_created_at_idx
  on public.flow_generation_logs(user_id, created_at desc);

create index if not exists flow_generation_logs_user_range_idx
  on public.flow_generation_logs(user_id, range_start, range_end);

create index if not exists flow_generation_logs_served_from_cache_idx
  on public.flow_generation_logs(user_id, served_from_cache);
