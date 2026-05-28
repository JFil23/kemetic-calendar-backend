-- Ma'at guidance delivery foundation.
-- One row in maat_guidance_deliveries is one floating guidance surface.

create extension if not exists pgcrypto;

alter table public.reflection_generations
  drop constraint if exists reflection_generations_period_type_check;

alter table public.reflection_generations
  add constraint reflection_generations_period_type_check
  check (
    period_type = any (
      array[
        'daily'::text,
        'decan'::text,
        'monthly'::text,
        'manual'::text,
        'decan_opening'::text,
        'maat_nudge'::text
      ]
    )
  );

create table if not exists public.maat_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  window_date date not null,
  decan_period_key text not null,
  window_start date not null,
  window_end date not null,
  dimensions jsonb not null default '{}'::jsonb,
  score integer not null default 0,
  band text not null check (
    band in (
      'maat',
      'leaning_maat',
      'mixed',
      'leaning_isfet',
      'isfet_patterned'
    )
  ),
  reflection_move text not null check (
    reflection_move in ('affirm', 'inquire', 'correct')
  ),
  lead_axis text not null,
  correction_axes text[] not null default '{}'::text[],
  hard_gates text[] not null default '{}'::text[],
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, window_date, decan_period_key)
);

create table if not exists public.maat_guidance_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (
    kind in ('decan_opening', 'drift_nudge', 'strength_nudge')
  ),
  decan_period_key text not null,
  status text not null default 'pending' check (
    status in (
      'pending',
      'shown',
      'dismissed',
      'opened',
      'acted',
      'expired'
    )
  ),
  priority integer not null,
  teaser_text text not null,
  body_text text not null,
  payload jsonb not null default '{}'::jsonb,
  cta_type text not null default 'none' check (
    cta_type in ('none', 'node', 'flow', 'flow_template')
  ),
  cta_ref text,
  generation_id uuid references public.reflection_generations(id)
    on delete set null,
  trigger_reason text,
  shown_at timestamptz,
  dismissed_at timestamptz,
  opened_at timestamptz,
  acted_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maat_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decan_period_key text not null,
  snapshot_id uuid references public.maat_snapshots(id) on delete set null,
  status text not null default 'open' check (
    status in ('open', 'completed', 'dismissed', 'expired')
  ),
  lead_axis text,
  hard_gates text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_maat_guidance_decan_opening
  on public.maat_guidance_deliveries (user_id, decan_period_key)
  where kind = 'decan_opening';

create unique index if not exists uq_maat_guidance_strength_nudge
  on public.maat_guidance_deliveries (user_id, decan_period_key)
  where kind = 'strength_nudge';

create index if not exists idx_maat_guidance_pending
  on public.maat_guidance_deliveries (user_id, status, priority, created_at);

create index if not exists idx_maat_guidance_decan
  on public.maat_guidance_deliveries (user_id, decan_period_key, kind);

create index if not exists idx_maat_snapshots_user_decan_date
  on public.maat_snapshots (user_id, decan_period_key, window_date desc);

create index if not exists idx_maat_corrections_open
  on public.maat_corrections (user_id, decan_period_key, status, created_at desc);

create unique index if not exists uq_maat_corrections_open
  on public.maat_corrections (user_id, decan_period_key)
  where status = 'open';

create or replace function public.enforce_maat_guidance_delivery_caps()
returns trigger
language plpgsql
as $$
declare
  existing_count integer;
begin
  if new.kind = 'drift_nudge' then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text || ':' || new.decan_period_key || ':drift_nudge'));

    select count(*)
      into existing_count
      from public.maat_guidance_deliveries d
     where d.user_id = new.user_id
       and d.decan_period_key = new.decan_period_key
       and d.kind = 'drift_nudge'
       and d.id is distinct from new.id;

    if existing_count >= 2 then
      raise exception 'drift_nudge cap reached for this decan'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_maat_guidance_delivery_caps
  on public.maat_guidance_deliveries;

create trigger trg_enforce_maat_guidance_delivery_caps
  before insert or update of kind, decan_period_key, user_id
  on public.maat_guidance_deliveries
  for each row
  execute function public.enforce_maat_guidance_delivery_caps();

drop trigger if exists trg_touch_maat_snapshots on public.maat_snapshots;
create trigger trg_touch_maat_snapshots
  before update on public.maat_snapshots
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_maat_guidance_deliveries
  on public.maat_guidance_deliveries;
create trigger trg_touch_maat_guidance_deliveries
  before update on public.maat_guidance_deliveries
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_maat_corrections on public.maat_corrections;
create trigger trg_touch_maat_corrections
  before update on public.maat_corrections
  for each row execute function public.touch_updated_at();

alter table public.maat_snapshots enable row level security;
alter table public.maat_guidance_deliveries enable row level security;
alter table public.maat_corrections enable row level security;

drop policy if exists "maat_snapshots owner select"
  on public.maat_snapshots;
create policy "maat_snapshots owner select"
  on public.maat_snapshots
  for select
  using (auth.uid() = user_id);

drop policy if exists "maat_guidance_deliveries owner select"
  on public.maat_guidance_deliveries;
create policy "maat_guidance_deliveries owner select"
  on public.maat_guidance_deliveries
  for select
  using (auth.uid() = user_id);

drop policy if exists "maat_corrections owner select"
  on public.maat_corrections;
create policy "maat_corrections owner select"
  on public.maat_corrections
  for select
  using (auth.uid() = user_id);

grant all on table public.maat_snapshots to anon, authenticated, service_role;
grant all on table public.maat_guidance_deliveries to anon, authenticated, service_role;
grant all on table public.maat_corrections to anon, authenticated, service_role;
