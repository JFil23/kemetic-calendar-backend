-- Nutrition sources for Today's Alignment.
-- This repair migration is intentionally idempotent so environments that
-- already have the table keep their data, while older projects get the schema.

create table if not exists public.nutrition_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nutrient text not null,
  source text,
  purpose text,
  mode text not null,
  days_of_week integer[],
  decan_days integer[],
  repeat boolean not null default true,
  time_h integer not null,
  time_m integer not null,
  alert_offset_minutes integer,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nutrition_items_mode_check
    check (mode in ('weekday', 'decan')),
  constraint nutrition_items_days_of_week_ck
    check (days_of_week is null or days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]),
  constraint nutrition_items_decan_days_ck
    check (decan_days is null or decan_days <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  constraint nutrition_items_not_both_ck
    check (
      not (
        coalesce(cardinality(days_of_week), 0) > 0
        and coalesce(cardinality(decan_days), 0) > 0
      )
    ),
  constraint nutrition_items_mode_consistency
    check (
      (
        mode = 'weekday'
        and coalesce(cardinality(decan_days), 0) = 0
      )
      or (
        mode = 'decan'
        and coalesce(cardinality(days_of_week), 0) = 0
      )
      or (
        coalesce(cardinality(days_of_week), 0) = 0
        and coalesce(cardinality(decan_days), 0) = 0
      )
    ),
  constraint ck_time_h check (time_h >= 0 and time_h <= 23),
  constraint ck_time_m check (time_m >= 0 and time_m <= 59)
);

alter table public.nutrition_items
  add column if not exists source text,
  add column if not exists purpose text,
  add column if not exists mode text not null default 'decan',
  add column if not exists days_of_week integer[],
  add column if not exists decan_days integer[],
  add column if not exists repeat boolean not null default true,
  add column if not exists time_h integer not null default 9,
  add column if not exists time_m integer not null default 0,
  add column if not exists alert_offset_minutes integer,
  add column if not exists enabled boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.nutrition_items
  drop constraint if exists ck_valid_mode_array,
  drop constraint if exists chk_nutrition_items_one_empty,
  drop constraint if exists nutrition_items_mode_check,
  drop constraint if exists nutrition_items_days_of_week_ck,
  drop constraint if exists nutrition_items_decan_days_ck,
  drop constraint if exists nutrition_items_not_both_ck,
  drop constraint if exists nutrition_items_mode_consistency,
  drop constraint if exists ck_time_h,
  drop constraint if exists ck_time_m;

alter table public.nutrition_items
  add constraint nutrition_items_mode_check
    check (mode in ('weekday', 'decan')) not valid,
  add constraint nutrition_items_days_of_week_ck
    check (days_of_week is null or days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]) not valid,
  add constraint nutrition_items_decan_days_ck
    check (decan_days is null or decan_days <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) not valid,
  add constraint nutrition_items_not_both_ck
    check (
      not (
        coalesce(cardinality(days_of_week), 0) > 0
        and coalesce(cardinality(decan_days), 0) > 0
      )
    ) not valid,
  add constraint nutrition_items_mode_consistency
    check (
      (
        mode = 'weekday'
        and coalesce(cardinality(decan_days), 0) = 0
      )
      or (
        mode = 'decan'
        and coalesce(cardinality(days_of_week), 0) = 0
      )
      or (
        coalesce(cardinality(days_of_week), 0) = 0
        and coalesce(cardinality(decan_days), 0) = 0
      )
    ) not valid,
  add constraint ck_time_h check (time_h >= 0 and time_h <= 23) not valid,
  add constraint ck_time_m check (time_m >= 0 and time_m <= 59) not valid;

alter table public.nutrition_items enable row level security;

create index if not exists idx_nutrition_items_user_id
  on public.nutrition_items(user_id);

grant select, insert, update, delete on public.nutrition_items to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nutrition_items'
      and policyname = 'nutrition_items_select'
  ) then
    create policy nutrition_items_select
      on public.nutrition_items
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nutrition_items'
      and policyname = 'nutrition_items_insert'
  ) then
    create policy nutrition_items_insert
      on public.nutrition_items
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nutrition_items'
      and policyname = 'nutrition_items_update'
  ) then
    create policy nutrition_items_update
      on public.nutrition_items
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nutrition_items'
      and policyname = 'nutrition_items_delete'
  ) then
    create policy nutrition_items_delete
      on public.nutrition_items
      for delete
      using (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.update_nutrition_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists nutrition_items_updated_at on public.nutrition_items;
create trigger nutrition_items_updated_at
  before update on public.nutrition_items
  for each row execute function public.update_nutrition_updated_at();
