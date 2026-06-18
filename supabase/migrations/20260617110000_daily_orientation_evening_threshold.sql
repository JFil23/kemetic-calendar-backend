create table if not exists public.daily_orientation (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  kemetic_day_key text,
  entry_state text,
  chosen_return text,
  source text,
  set_at timestamptz,
  landing_status text,
  landed_at timestamptz,
  carryover_choice text,
  evening_reflection_status text,
  badge_label text,
  status text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, local_date),
  constraint daily_orientation_chosen_return_not_blank
    check (chosen_return is null or length(btrim(chosen_return)) > 0),
  constraint daily_orientation_landing_status_check
    check (
      landing_status is null or
      landing_status in ('held', 'slipped', 'working_on_it')
    ),
  constraint daily_orientation_status_check
    check (status is null or status in ('started', 'completed', 'skipped'))
);

alter table public.daily_orientation
  add column if not exists kemetic_day_key text,
  add column if not exists entry_state text,
  add column if not exists chosen_return text,
  add column if not exists source text,
  add column if not exists set_at timestamptz,
  add column if not exists landing_status text,
  add column if not exists landed_at timestamptz,
  add column if not exists carryover_choice text,
  add column if not exists evening_reflection_status text,
  add column if not exists badge_label text,
  add column if not exists status text,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists daily_orientation_user_date_idx
  on public.daily_orientation (user_id, local_date);

create index if not exists daily_orientation_user_chosen_return_idx
  on public.daily_orientation (user_id, local_date desc)
  where chosen_return is not null;

alter table public.daily_orientation
  enable row level security;

revoke all privileges
  on public.daily_orientation
  from anon, authenticated;

grant select, insert, update, delete
  on public.daily_orientation
  to authenticated;

drop policy if exists "Users can select own daily orientation"
  on public.daily_orientation;
create policy "Users can select own daily orientation"
  on public.daily_orientation
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own daily orientation"
  on public.daily_orientation;
create policy "Users can insert own daily orientation"
  on public.daily_orientation
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily orientation"
  on public.daily_orientation;
create policy "Users can update own daily orientation"
  on public.daily_orientation
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own daily orientation"
  on public.daily_orientation;
create policy "Users can delete own daily orientation"
  on public.daily_orientation
  for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.evening_threshold_decisions (
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_date date not null,
  decision text not null,
  new_carry_text text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, decision_date),
  constraint evening_threshold_decisions_decision_check
    check (decision in ('carried', 'released')),
  constraint evening_threshold_decisions_new_carry_text_not_blank
    check (new_carry_text is null or length(btrim(new_carry_text)) > 0)
);

alter table public.evening_threshold_decisions
  add column if not exists decision text,
  add column if not exists new_carry_text text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists evening_threshold_decisions_user_date_idx
  on public.evening_threshold_decisions (user_id, decision_date);

alter table public.evening_threshold_decisions
  enable row level security;

revoke all privileges
  on public.evening_threshold_decisions
  from anon, authenticated;

grant select, insert, update, delete
  on public.evening_threshold_decisions
  to authenticated;

drop policy if exists "Users can select own evening threshold decisions"
  on public.evening_threshold_decisions;
create policy "Users can select own evening threshold decisions"
  on public.evening_threshold_decisions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own evening threshold decisions"
  on public.evening_threshold_decisions;
create policy "Users can insert own evening threshold decisions"
  on public.evening_threshold_decisions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own evening threshold decisions"
  on public.evening_threshold_decisions;
create policy "Users can update own evening threshold decisions"
  on public.evening_threshold_decisions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own evening threshold decisions"
  on public.evening_threshold_decisions;
create policy "Users can delete own evening threshold decisions"
  on public.evening_threshold_decisions
  for delete
  to authenticated
  using (auth.uid() = user_id);
