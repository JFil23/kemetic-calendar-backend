begin;

-- Cut 15 rollback: restore only the two prior raw-timing reader definitions.
-- View columns, grants, ownership, and security_invoker behavior remain intact.
create or replace view public.maat_delivery_timing_health
with (security_invoker = true) as
with duplicate_sent_keys as (
  select delivery_key
  from public.maat_delivery_timing_events
  where delivery_status = 'sent'
  group by delivery_key
  having count(*) > 1
)
select
  event.delivery_kind,
  event.cron_job_name,
  count(*) filter (where event.delivery_status = 'picked') as picked_count,
  count(*) filter (where event.delivery_status = 'sent') as sent_count,
  count(*) filter (where event.delivery_status = 'skipped') as skipped_count,
  count(*) filter (where event.delivery_status = 'failed') as failed_count,
  count(*) filter (where event.delivery_status = 'duplicate_guarded')
    as duplicate_guarded_count,
  count(distinct event.delivery_key) filter (
    where duplicate.delivery_key is not null
  ) as duplicate_sent_key_count,
  max(event.created_at) as last_event_at,
  max(event.delivered_at) filter (where event.delivery_status = 'sent')
    as last_sent_at,
  max(event.delivery_latency_seconds) filter (
    where event.delivery_status = 'sent'
  ) as max_latency_seconds,
  round(
    avg(event.delivery_latency_seconds) filter (
      where event.delivery_status = 'sent'
    ),
    2
  ) as avg_latency_seconds,
  count(*) filter (
    where event.delivery_status = 'sent'
      and coalesce(
        event.delivery_latency_seconds > case
          when event.delivery_kind in ('reminder', 'scheduled_notification')
            then 90
          when event.delivery_kind = 'decan_reflection' then 420
          when event.delivery_kind in (
            'decan_opening',
            'drift_nudge',
            'strength_nudge'
          ) then 3600
          else 300
        end,
        false
      )
  ) as late_count
from public.maat_delivery_timing_events event
left join duplicate_sent_keys duplicate
  on duplicate.delivery_key = event.delivery_key
group by event.delivery_kind, event.cron_job_name;

comment on view public.maat_delivery_timing_health is null;

create or replace view public.maat_delivery_receipt_health
with (security_invoker = true) as
with sent_events as (
  select
    event.delivery_key,
    (array_agg(event.delivery_kind order by event.created_at desc))[1]
      as delivery_kind,
    (array_agg(event.target_table order by event.created_at desc))[1]
      as target_table,
    (array_agg(event.target_id order by event.created_at desc))[1]
      as target_id,
    (array_agg(event.user_id order by event.created_at desc))[1] as user_id,
    min(event.scheduled_for) as scheduled_for,
    min(event.delivered_at) filter (where event.delivered_at is not null)
      as sent_at,
    min(event.delivery_latency_seconds) filter (
      where event.delivery_status = 'sent'
    ) as server_delivery_latency_seconds,
    (array_agg(event.cron_job_name order by event.created_at desc))[1]
      as cron_job_name,
    count(*) filter (where event.delivery_status = 'sent') as sent_count,
    count(*) filter (where event.delivery_status = 'skipped') as skipped_count
  from public.maat_delivery_timing_events event
  where event.delivery_status in ('sent', 'skipped')
  group by event.delivery_key
),
receipt_events as (
  select
    receipt.delivery_key,
    min(receipt.event_at) filter (where receipt.receipt_event = 'received')
      as first_received_at,
    min(receipt.event_at) filter (where receipt.receipt_event = 'shown')
      as first_shown_at,
    min(receipt.event_at) filter (where receipt.receipt_event = 'opened')
      as first_opened_at,
    min(receipt.event_at) filter (where receipt.receipt_event = 'dismissed')
      as first_dismissed_at,
    min(receipt.event_at) filter (where receipt.receipt_event = 'acted')
      as first_acted_at,
    min(receipt.event_at) filter (where receipt.receipt_event = 'expired')
      as first_expired_at,
    count(*) as receipt_event_count
  from public.maat_delivery_receipt_events receipt
  group by receipt.delivery_key
)
select
  sent.delivery_key,
  sent.delivery_kind,
  sent.target_table,
  sent.target_id,
  sent.user_id,
  sent.scheduled_for,
  sent.sent_at,
  sent.server_delivery_latency_seconds,
  sent.cron_job_name,
  sent.sent_count,
  sent.skipped_count,
  receipt.first_received_at,
  receipt.first_shown_at,
  receipt.first_opened_at,
  receipt.first_dismissed_at,
  receipt.first_acted_at,
  receipt.first_expired_at,
  coalesce(receipt.receipt_event_count, 0) as receipt_event_count,
  (
    receipt.first_received_at is not null
    or receipt.first_shown_at is not null
    or receipt.first_opened_at is not null
    or receipt.first_dismissed_at is not null
    or receipt.first_acted_at is not null
    or receipt.first_expired_at is not null
  ) as has_receipt,
  (
    receipt.first_opened_at is not null
    or receipt.first_dismissed_at is not null
    or receipt.first_acted_at is not null
  ) as has_user_action,
  case
    when sent.sent_at is null then null
    when sent.delivery_kind in (
      'reminder',
      'scheduled_notification',
      'decan_reflection',
      'push_test'
    ) and receipt.first_received_at is not null then greatest(
      0,
      floor(extract(epoch from receipt.first_received_at - sent.sent_at))::integer
    )
    when sent.delivery_kind in (
      'decan_opening',
      'drift_nudge',
      'strength_nudge',
      'maat_guidance'
    ) and receipt.first_shown_at is not null then greatest(
      0,
      floor(extract(epoch from receipt.first_shown_at - sent.sent_at))::integer
    )
    else null
  end as receipt_latency_seconds,
  case
    when sent.sent_at is null or receipt.first_opened_at is null then null
    else greatest(
      0,
      floor(extract(epoch from receipt.first_opened_at - sent.sent_at))::integer
    )
  end as open_latency_seconds,
  case
    when sent.sent_count = 0 and sent.skipped_count > 0 then 'not_sent'
    when sent.sent_at is null then 'no_server_sent'
    when receipt.first_acted_at is not null then 'acted'
    when receipt.first_dismissed_at is not null then 'dismissed'
    when receipt.first_opened_at is not null then 'opened'
    when receipt.first_received_at is not null
      or receipt.first_shown_at is not null then 'received'
    when sent.delivery_kind in (
      'reminder',
      'scheduled_notification',
      'decan_reflection',
      'push_test'
    ) and now() - sent.sent_at > interval '15 minutes' then 'receipt_missing'
    when sent.delivery_kind in (
      'decan_opening',
      'drift_nudge',
      'strength_nudge',
      'maat_guidance'
    ) and now() - sent.sent_at > interval '1 hour' then 'surface_missing'
    else 'awaiting_receipt'
  end as receipt_status
from sent_events sent
left join receipt_events receipt
  on receipt.delivery_key = sent.delivery_key;

comment on view public.maat_delivery_receipt_health is null;

commit;
