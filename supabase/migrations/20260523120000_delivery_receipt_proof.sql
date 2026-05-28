-- Delivery receipt proof: capture app/device lifecycle acknowledgements,
-- join them to server delivery timing, and expose alertable health rows.

create table if not exists public.maat_delivery_receipt_events (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null,
  delivery_kind text not null,
  user_id uuid,
  device_id text,
  platform text,
  message_id text,
  receipt_event text not null,
  event_at timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint maat_delivery_receipt_events_event_check check (
    receipt_event = any (
      array[
        'received'::text,
        'shown'::text,
        'opened'::text,
        'dismissed'::text,
        'acted'::text,
        'expired'::text
      ]
    )
  )
);

create unique index if not exists idx_maat_delivery_receipt_events_once
  on public.maat_delivery_receipt_events (
    coalesce(user_id::text, ''),
    delivery_key,
    receipt_event,
    coalesce(device_id, ''),
    coalesce(message_id, '')
  );

create index if not exists idx_maat_delivery_receipt_events_key
  on public.maat_delivery_receipt_events (delivery_key, receipt_event);

create index if not exists idx_maat_delivery_receipt_events_created
  on public.maat_delivery_receipt_events (created_at desc);

create index if not exists idx_maat_delivery_receipt_events_user
  on public.maat_delivery_receipt_events (user_id, created_at desc);

comment on table public.maat_delivery_receipt_events is
'Last-mile delivery proof from app/device lifecycle events: received, shown, opened, dismissed, acted, or expired. Rows join to maat_delivery_timing_events by delivery_key.';

drop view if exists public.maat_delivery_alerts;
drop view if exists public.maat_delivery_receipt_health;

create or replace view public.maat_delivery_receipt_health
with (security_invoker = true) as
with sent_events as (
  select
    e.delivery_key,
    (array_agg(e.delivery_kind order by e.created_at desc))[1] as delivery_kind,
    (array_agg(e.target_table order by e.created_at desc))[1] as target_table,
    (array_agg(e.target_id order by e.created_at desc))[1] as target_id,
    (array_agg(e.user_id order by e.created_at desc))[1] as user_id,
    min(e.scheduled_for) as scheduled_for,
    min(e.delivered_at) filter (where e.delivered_at is not null) as sent_at,
    min(e.delivery_latency_seconds) filter (
      where e.delivery_status = 'sent'
    ) as server_delivery_latency_seconds,
    (array_agg(e.cron_job_name order by e.created_at desc))[1]
      as cron_job_name,
    count(*) filter (where e.delivery_status = 'sent') as sent_count,
    count(*) filter (where e.delivery_status = 'skipped') as skipped_count
  from public.maat_delivery_timing_events e
  where e.delivery_status in ('sent', 'skipped')
  group by e.delivery_key
),
receipt_events as (
  select
    r.delivery_key,
    min(r.event_at) filter (where r.receipt_event = 'received')
      as first_received_at,
    min(r.event_at) filter (where r.receipt_event = 'shown')
      as first_shown_at,
    min(r.event_at) filter (where r.receipt_event = 'opened')
      as first_opened_at,
    min(r.event_at) filter (where r.receipt_event = 'dismissed')
      as first_dismissed_at,
    min(r.event_at) filter (where r.receipt_event = 'acted')
      as first_acted_at,
    min(r.event_at) filter (where r.receipt_event = 'expired')
      as first_expired_at,
    count(*) as receipt_event_count
  from public.maat_delivery_receipt_events r
  group by r.delivery_key
)
select
  s.delivery_key,
  s.delivery_kind,
  s.target_table,
  s.target_id,
  s.user_id,
  s.scheduled_for,
  s.sent_at,
  s.server_delivery_latency_seconds,
  s.cron_job_name,
  s.sent_count,
  s.skipped_count,
  r.first_received_at,
  r.first_shown_at,
  r.first_opened_at,
  r.first_dismissed_at,
  r.first_acted_at,
  r.first_expired_at,
  coalesce(r.receipt_event_count, 0) as receipt_event_count,
  (
    r.first_received_at is not null
    or r.first_shown_at is not null
    or r.first_opened_at is not null
    or r.first_dismissed_at is not null
    or r.first_acted_at is not null
    or r.first_expired_at is not null
  ) as has_receipt,
  (
    r.first_opened_at is not null
    or r.first_dismissed_at is not null
    or r.first_acted_at is not null
  ) as has_user_action,
  case
    when s.sent_at is null then null
    when s.delivery_kind in ('reminder', 'scheduled_notification',
      'decan_reflection', 'push_test')
      and r.first_received_at is not null then greatest(
        0,
        floor(extract(epoch from r.first_received_at - s.sent_at))::integer
      )
    when s.delivery_kind in ('decan_opening', 'drift_nudge',
      'strength_nudge', 'maat_guidance')
      and r.first_shown_at is not null then greatest(
        0,
        floor(extract(epoch from r.first_shown_at - s.sent_at))::integer
      )
    else null
  end as receipt_latency_seconds,
  case
    when s.sent_at is null or r.first_opened_at is null then null
    else greatest(
      0,
      floor(extract(epoch from r.first_opened_at - s.sent_at))::integer
    )
  end as open_latency_seconds,
  case
    when s.sent_count = 0 and s.skipped_count > 0 then 'not_sent'
    when s.sent_at is null then 'no_server_sent'
    when r.first_acted_at is not null then 'acted'
    when r.first_dismissed_at is not null then 'dismissed'
    when r.first_opened_at is not null then 'opened'
    when r.first_received_at is not null or r.first_shown_at is not null
      then 'received'
    when s.delivery_kind in ('reminder', 'scheduled_notification',
      'decan_reflection', 'push_test')
      and now() - s.sent_at > interval '15 minutes'
      then 'receipt_missing'
    when s.delivery_kind in ('decan_opening', 'drift_nudge',
      'strength_nudge', 'maat_guidance')
      and now() - s.sent_at > interval '1 hour'
      then 'surface_missing'
    else 'awaiting_receipt'
  end as receipt_status
from sent_events s
left join receipt_events r on r.delivery_key = s.delivery_key;

create or replace view public.maat_delivery_alerts
with (security_invoker = true) as
select
  concat('cron:', c.job_name) as alert_key,
  case
    when c.health_status in ('late', 'no_success_yet') then 'critical'
    when c.health_status = 'paused' then 'warning'
    else 'info'
  end as severity,
  'cron_health'::text as source,
  c.job_name as subject,
  concat('cron status ', c.health_status, '; last success ',
    coalesce(c.last_success_at::text, 'never')) as detail,
  now() as created_at
from public.maat_delivery_cron_health c
where c.health_status <> 'healthy'
union all
select
  concat('timing:', t.cron_job_name, ':', t.delivery_kind) as alert_key,
  case
    when t.failed_count > 0 or t.duplicate_sent_key_count > 0 then 'critical'
    else 'warning'
  end as severity,
  'delivery_timing'::text as source,
  concat(t.cron_job_name, '/', t.delivery_kind) as subject,
  concat(
    'failed=', t.failed_count,
    '; late=', t.late_count,
    '; duplicate_sent=', t.duplicate_sent_key_count,
    '; max_latency=', coalesce(t.max_latency_seconds::text, 'n/a')
  ) as detail,
  now() as created_at
from public.maat_delivery_timing_health t
where t.failed_count > 0
   or t.late_count > 0
   or t.duplicate_sent_key_count > 0
union all
select
  concat('receipt:', r.delivery_key) as alert_key,
  'warning'::text as severity,
  'delivery_receipt'::text as source,
  r.delivery_key as subject,
  concat(
    'receipt status ', r.receipt_status,
    '; sent_at=', coalesce(r.sent_at::text, 'none'),
    '; kind=', r.delivery_kind
  ) as detail,
  now() as created_at
from public.maat_delivery_receipt_health r
where r.receipt_status in ('receipt_missing', 'surface_missing');

grant select, insert on public.maat_delivery_receipt_events to service_role;
grant select on public.maat_delivery_receipt_health to service_role;
grant select on public.maat_delivery_alerts to service_role;
