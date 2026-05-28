-- Durable Ma'at ledger: auditable obligations and restoration attempts.

create table if not exists public.maat_obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  decan_period_key text not null,
  obligation_key text not null,
  source_type text not null default 'maat_snapshot_ledger',
  source_id text,
  field text not null,
  status text not null default 'open',
  axis_codes text[] not null default '{}',
  isfet_patterns text[] not null default '{}',
  open_count integer not null default 0,
  broken_count integer not null default 0,
  leak_score numeric not null default 0,
  weight numeric not null default 0,
  suggested_restoration jsonb not null default '{}'::jsonb,
  last_delivery_id uuid,
  opened_at timestamptz not null default now(),
  acted_at timestamptz,
  resolved_at timestamptz,
  released_at timestamptz,
  dismissed_at timestamptz,
  expired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maat_obligations_field_check check (
    field in (
      'provision',
      'visible_work',
      'truthful_record',
      'care',
      'measure',
      'restraint',
      'cohesion',
      'life_preservation',
      'general'
    )
  ),
  constraint maat_obligations_status_check check (
    status in (
      'open',
      'acted',
      'resolved',
      'released',
      'expired',
      'broken',
      'dismissed'
    )
  )
);

create unique index if not exists idx_maat_obligations_user_key
  on public.maat_obligations (user_id, obligation_key);

create index if not exists idx_maat_obligations_user_status
  on public.maat_obligations (user_id, status, updated_at desc);

create index if not exists idx_maat_obligations_decan_field
  on public.maat_obligations (user_id, decan_period_key, field);

create index if not exists idx_maat_obligations_last_delivery
  on public.maat_obligations (last_delivery_id);

comment on table public.maat_obligations is
'Durable Ma''at account rows. An obligation records an open order/leak that guidance can attempt to restore without framing the user as failed.';

create table if not exists public.maat_restoration_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  obligation_id uuid references public.maat_obligations(id) on delete set null,
  delivery_id uuid references public.maat_guidance_deliveries(id) on delete set null,
  delivery_kind text not null,
  decan_period_key text not null,
  attempt_key text not null,
  field text not null,
  action_text text not null,
  direction text not null default 'tend',
  cta_type text,
  cta_ref text,
  trigger_reason text,
  status text not null default 'suggested',
  suggested_at timestamptz not null default now(),
  shown_at timestamptz,
  opened_at timestamptz,
  acted_at timestamptz,
  resolved_at timestamptz,
  dismissed_at timestamptz,
  expired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maat_restoration_attempts_field_check check (
    field in (
      'provision',
      'visible_work',
      'truthful_record',
      'care',
      'measure',
      'restraint',
      'cohesion',
      'life_preservation',
      'general'
    )
  ),
  constraint maat_restoration_attempts_direction_check check (
    direction in (
      'enhance',
      'strengthen',
      'engage',
      'tend',
      'restore',
      'release',
      'reduce'
    )
  ),
  constraint maat_restoration_attempts_status_check check (
    status in (
      'suggested',
      'shown',
      'opened',
      'acted',
      'resolved',
      'dismissed',
      'expired',
      'repeated'
    )
  )
);

create unique index if not exists idx_maat_restoration_attempts_user_key
  on public.maat_restoration_attempts (user_id, attempt_key);

create unique index if not exists idx_maat_restoration_attempts_delivery_once
  on public.maat_restoration_attempts (delivery_id)
  where delivery_id is not null;

create index if not exists idx_maat_restoration_attempts_user_status
  on public.maat_restoration_attempts (user_id, status, updated_at desc);

create index if not exists idx_maat_restoration_attempts_obligation
  on public.maat_restoration_attempts (obligation_id, status, updated_at desc);

comment on table public.maat_restoration_attempts is
'Lifecycle rows for guidance restorations: suggested, shown, opened, acted, resolved, dismissed, or expired. Attempts connect a visible nudge to the obligation it was meant to restore.';

drop view if exists public.maat_ledger_restoration_health;

create or replace view public.maat_ledger_restoration_health as
select
  o.id as obligation_id,
  o.user_id,
  o.decan_period_key,
  o.obligation_key,
  o.field,
  o.status as obligation_status,
  o.open_count,
  o.broken_count,
  o.leak_score,
  o.axis_codes,
  o.isfet_patterns,
  o.suggested_restoration,
  o.last_delivery_id,
  o.opened_at as obligation_opened_at,
  o.acted_at as obligation_acted_at,
  o.resolved_at as obligation_resolved_at,
  count(a.id) as attempt_count,
  count(a.id) filter (where a.status = 'suggested') as suggested_count,
  count(a.id) filter (where a.status = 'shown') as shown_count,
  count(a.id) filter (where a.status = 'opened') as opened_count,
  count(a.id) filter (where a.status = 'acted') as acted_count,
  count(a.id) filter (where a.status = 'dismissed') as dismissed_count,
  count(a.id) filter (where a.status = 'expired') as expired_count,
  max(a.suggested_at) as last_suggested_at,
  max(a.opened_at) as last_opened_at,
  max(a.acted_at) as last_acted_at,
  max(a.dismissed_at) as last_dismissed_at,
  max(a.expired_at) as last_expired_at,
  (array_agg(a.status order by a.updated_at desc)
    filter (where a.id is not null))[1] as last_attempt_status
from public.maat_obligations o
left join public.maat_restoration_attempts a
  on a.obligation_id = o.id
group by o.id;

grant select, insert, update on public.maat_obligations to service_role;
grant select, insert, update on public.maat_restoration_attempts to service_role;
grant select on public.maat_ledger_restoration_health to service_role;
