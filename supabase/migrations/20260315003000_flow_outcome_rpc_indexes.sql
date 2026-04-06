-- Indexes for compute_flow_outcome RPC and cron selection

create index if not exists user_events_user_id_flow_local_id_starts_at_idx
  on public.user_events (user_id, flow_local_id, starts_at);

create index if not exists journal_entries_user_id_flow_id_greg_date_idx
  on public.journal_entries (user_id, flow_id, greg_date);

create index if not exists app_events_user_id_created_at_idx
  on public.app_events (user_id, created_at);
