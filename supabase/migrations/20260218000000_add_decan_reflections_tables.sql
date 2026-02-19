-- Ensure decan reflection tables and RLS exist (idempotent-ish with IF NOT EXISTS)
create extension if not exists "uuid-ossp";

create table if not exists public.decan_reflections (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    decan_name text not null,
    decan_theme text,
    decan_start date not null,
    decan_end date not null,
    badge_count integer default 0,
    reflection_text text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.decan_reflection_schedule (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    decan_start date not null,
    decan_end date not null,
    send_at timestamptz not null,
    status text not null default 'pending',
    claimed_at timestamptz,
    sent_at timestamptz,
    last_error text,
    created_at timestamptz not null default now()
);

-- RLS
alter table public.decan_reflections enable row level security;
alter table public.decan_reflection_schedule enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'decan_reflections' and policyname = 'decan_reflections_select_own') then
    create policy decan_reflections_select_own on public.decan_reflections
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'decan_reflections' and policyname = 'decan_reflections_insert_own') then
    create policy decan_reflections_insert_own on public.decan_reflections
      for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'decan_reflection_schedule' and policyname = 'decan_reflection_schedule_select_own') then
    create policy decan_reflection_schedule_select_own on public.decan_reflection_schedule
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'decan_reflection_schedule' and policyname = 'decan_reflection_schedule_insert_own') then
    create policy decan_reflection_schedule_insert_own on public.decan_reflection_schedule
      for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'decan_reflection_schedule' and policyname = 'decan_reflection_schedule_update_own') then
    create policy decan_reflection_schedule_update_own on public.decan_reflection_schedule
      for update using (auth.uid() = user_id);
  end if;
end$$;
