create table if not exists public.calendar_occurrence_exclusions (
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_kind text not null,
  source_id text not null,
  occurrence_local_date date not null,
  reason text not null default 'user_deleted',
  created_at timestamptz not null default now(),
  primary key (
    user_id,
    occurrence_kind,
    source_id,
    occurrence_local_date
  ),
  constraint calendar_occurrence_exclusions_kind_nonempty
    check (btrim(occurrence_kind) <> ''),
  constraint calendar_occurrence_exclusions_source_nonempty
    check (btrim(source_id) <> '')
);

comment on table public.calendar_occurrence_exclusions is
'Durable user intent that suppresses one generated calendar occurrence. Materialized user_events rows remain a replaceable cache.';

alter table public.calendar_occurrence_exclusions enable row level security;

drop policy if exists "Users can view their occurrence exclusions"
  on public.calendar_occurrence_exclusions;
create policy "Users can view their occurrence exclusions"
  on public.calendar_occurrence_exclusions
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can create their occurrence exclusions"
  on public.calendar_occurrence_exclusions;
create policy "Users can create their occurrence exclusions"
  on public.calendar_occurrence_exclusions
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their occurrence exclusions"
  on public.calendar_occurrence_exclusions;
create policy "Users can update their occurrence exclusions"
  on public.calendar_occurrence_exclusions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can remove their occurrence exclusions"
  on public.calendar_occurrence_exclusions;
create policy "Users can remove their occurrence exclusions"
  on public.calendar_occurrence_exclusions
  for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.calendar_occurrence_exclusions from anon;
grant select, insert, update, delete
  on table public.calendar_occurrence_exclusions to authenticated;
grant all on table public.calendar_occurrence_exclusions to service_role;
