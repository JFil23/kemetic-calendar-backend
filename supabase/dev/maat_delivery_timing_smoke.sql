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
    'smoke:reminder:on-time',
    'reminder',
    'reminders',
    'smoke-reminder',
    now() - interval '30 seconds',
    now() - interval '10 seconds',
    now(),
    'cron_reminder_push_1m',
    'sent',
    '{"smoke": true}'::jsonb
  ),
  (
    'smoke:decan-reflection:late',
    'decan_reflection',
    'decan_reflection_schedule',
    'smoke-reflection',
    now() - interval '10 minutes',
    now() - interval '5 minutes',
    now(),
    'decan_reflection_push_5m',
    'sent',
    '{"smoke": true}'::jsonb
  ),
  (
    'smoke:scheduled:failed',
    'scheduled_notification',
    'scheduled_notifications',
    '123',
    now() - interval '2 minutes',
    now() - interval '1 minute',
    now(),
    'cron_reminder_push_1m',
    'failed',
    '{"smoke": true}'::jsonb
  );

select
  delivery_kind,
  cron_job_name,
  sent_count,
  failed_count,
  late_count
from public.maat_delivery_timing_health
where cron_job_name in ('cron_reminder_push_1m', 'decan_reflection_push_5m')
order by cron_job_name, delivery_kind;

select
  job_name,
  health_status
from public.maat_delivery_cron_health
order by job_name;

select
  to_regprocedure(
    'public.claim_due_reminders(timestamp with time zone, integer)'
  ) is not null as claim_due_reminders_exists;

rollback;
