begin;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  function_started_at,
  delivered_at,
  cron_job_name,
  delivery_status,
  metadata
) values
  (
    'smoke:receipt:opened',
    'reminder',
    'reminders',
    'smoke-opened',
    now() - interval '2 minutes',
    now() - interval '90 seconds',
    now() - interval '60 seconds',
    'cron_reminder_push_1m',
    'sent',
    '{"smoke": true}'::jsonb
  ),
  (
    'smoke:receipt:missing',
    'decan_reflection',
    'decan_reflection_schedule',
    'smoke-missing',
    now() - interval '30 minutes',
    now() - interval '29 minutes',
    now() - interval '29 minutes',
    'decan_reflection_push_5m',
    'sent',
    '{"smoke": true}'::jsonb
  );

insert into public.maat_delivery_receipt_events (
  delivery_key,
  delivery_kind,
  receipt_event,
  event_at,
  device_id,
  platform,
  message_id,
  metadata
) values
  (
    'smoke:receipt:opened',
    'reminder',
    'received',
    now() - interval '45 seconds',
    'smoke-device',
    'ios',
    'smoke-message',
    '{"smoke": true}'::jsonb
  ),
  (
    'smoke:receipt:opened',
    'reminder',
    'opened',
    now() - interval '20 seconds',
    'smoke-device',
    'ios',
    'smoke-message',
    '{"smoke": true}'::jsonb
  );

select
  delivery_key,
  delivery_kind,
  receipt_event_count,
  receipt_status,
  receipt_latency_seconds,
  open_latency_seconds
from public.maat_delivery_receipt_health
where delivery_key in ('smoke:receipt:opened', 'smoke:receipt:missing')
order by delivery_key;

select
  source,
  subject
from public.maat_delivery_alerts
where alert_key = 'receipt:smoke:receipt:missing';

select
  to_regclass('public.idx_maat_delivery_receipt_events_device_once') is not null
    as device_receipt_unique_guard_exists;

rollback;
