-- Ma'at guidance observability and regression support.

create table if not exists public.maat_guidance_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid references public.maat_snapshots(id) on delete set null,
  decan_period_key text not null,
  window_date date not null,
  policy_version text not null,
  maturity_level text not null,
  shaping_fingerprint jsonb not null default '{}'::jsonb,
  decision jsonb not null default '{}'::jsonb,
  suppressed text[] not null default '{}'::text[],
  created_delivery_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

create table if not exists public.maat_band_transitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id uuid references public.maat_guidance_evaluations(id)
    on delete set null,
  snapshot_id uuid references public.maat_snapshots(id) on delete set null,
  decan_period_key text not null,
  from_window_date date not null,
  to_window_date date not null,
  from_band text not null,
  to_band text not null,
  created_at timestamptz not null default now(),
  unique (
    user_id,
    decan_period_key,
    from_window_date,
    to_window_date,
    from_band,
    to_band
  )
);

create index if not exists idx_maat_guidance_evaluations_user_decan_date
  on public.maat_guidance_evaluations
  (user_id, decan_period_key, window_date desc, created_at desc);

create index if not exists idx_maat_band_transitions_user_decan_date
  on public.maat_band_transitions
  (user_id, decan_period_key, to_window_date desc);

alter table public.maat_guidance_evaluations enable row level security;
alter table public.maat_band_transitions enable row level security;

drop policy if exists "maat_guidance_evaluations owner select"
  on public.maat_guidance_evaluations;
create policy "maat_guidance_evaluations owner select"
  on public.maat_guidance_evaluations
  for select
  using (auth.uid() = user_id);

drop policy if exists "maat_band_transitions owner select"
  on public.maat_band_transitions;
create policy "maat_band_transitions owner select"
  on public.maat_band_transitions
  for select
  using (auth.uid() = user_id);

grant all on table public.maat_guidance_evaluations
  to anon, authenticated, service_role;
grant all on table public.maat_band_transitions
  to anon, authenticated, service_role;

alter table public.user_choice_events
  drop constraint if exists user_choice_events_event_type_check;

alter table public.user_choice_events
  add constraint user_choice_events_event_type_check
  check (
    event_type = any (
      array[
        'node_opened'::text,
        'node_link_tapped'::text,
        'node_insight_saved'::text,
        'journal_linked_to_node'::text,
        'reflection_linked_to_node'::text,
        'node_linked_to_journal'::text,
        'node_linked_to_reflection'::text,
        'flow_completed'::text,
        'flow_skipped'::text,
        'reflection_opened'::text,
        'reflection_saved'::text,
        'reflection_rated'::text,
        'cycle_field_saved'::text,
        'checklist_completed'::text,
        'checklist_partial'::text,
        'checklist_skipped'::text,
        'todo_created'::text,
        'todo_completed'::text,
        'suggestion_accepted'::text,
        'suggestion_dismissed'::text,
        'suggestion_snoozed'::text,
        'maat_correction_opened'::text,
        'maat_correction_recovered'::text,
        'maat_correction_completed'::text,
        'maat_correction_dismissed'::text
      ]
    )
  );
