begin;

-- Cut 15 moves aggregate delivery-health readers to the compact canonical
-- ledger. The event-level recent-events view deliberately remains on the
-- 14-day raw timing table because it exposes metadata that is not represented
-- in the ledger.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace view public.maat_delivery_timing_health
with (security_invoker = true) as
select
  ledger.delivery_kind,
  ledger.cron_job_name,
  sum(ledger.picked_count)::bigint as picked_count,
  sum(ledger.sent_count)::bigint as sent_count,
  sum(ledger.skipped_count)::bigint as skipped_count,
  sum(ledger.failed_count)::bigint as failed_count,
  sum(ledger.duplicate_guarded_count)::bigint
    as duplicate_guarded_count,
  count(*) filter (where ledger.sent_count > 1)
    as duplicate_sent_key_count,
  max(ledger.last_event_at) as last_event_at,
  max(ledger.last_sent_at) as last_sent_at,
  max(ledger.max_sent_latency_seconds) as max_latency_seconds,
  round(
    sum(ledger.sent_latency_sum_seconds)::numeric
      / nullif(sum(ledger.sent_latency_count), 0),
    2
  ) as avg_latency_seconds,
  sum(ledger.late_sent_count)::bigint as late_count
from public.maat_delivery_ledger ledger
where ledger.last_event_at >= now() - interval '14 days'
group by ledger.delivery_kind, ledger.cron_job_name;

comment on view public.maat_delivery_timing_health is
'Fourteen-day aggregate delivery health sourced from the one-row-per-delivery ledger.';

create or replace view public.maat_delivery_receipt_health
with (security_invoker = true) as
with sent_events as (
  select
    ledger.delivery_key,
    ledger.delivery_kind,
    ledger.target_table,
    ledger.target_id,
    ledger.user_id,
    ledger.scheduled_for,
    ledger.first_delivered_at as sent_at,
    ledger.min_sent_latency_seconds as server_delivery_latency_seconds,
    ledger.cron_job_name,
    ledger.sent_count,
    ledger.skipped_count
  from public.maat_delivery_ledger ledger
  where (ledger.sent_count > 0 or ledger.skipped_count > 0)
    and ledger.last_event_at >= now() - interval '14 days'
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

comment on view public.maat_delivery_receipt_health is
'Fourteen-day delivery receipt health using server delivery state from the ledger and lifecycle acknowledgements from receipt events.';

commit;
