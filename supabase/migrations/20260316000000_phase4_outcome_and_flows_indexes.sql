-- Phase 4: hot-path indexes for outcome vectors and flow history

-- Recent outcomes per user (supports get_recent_outcome_vectors)
create index if not exists flow_outcomes_user_id_recorded_at_desc_idx
  on public.flow_outcomes (user_id, recorded_at desc);

-- User flows ordered by end_date (supports candidate/outcome queries)
create index if not exists flows_user_id_end_date_idx
  on public.flows (user_id, end_date);
