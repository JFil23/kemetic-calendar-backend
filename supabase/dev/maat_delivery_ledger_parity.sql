-- Cut 14 paired raw-versus-ledger proof. Run after the one-time backfill.
-- One MVCC statement snapshot is the stable cutoff while production writers
-- remain live; the insert trigger updates raw history and ledger atomically.
with raw_by_key as materialized (
  select
    e.delivery_key,
    min(e.delivery_kind) as delivery_kind,
    min(e.target_table) as target_table,
    min(e.target_id) as target_id,
    min(e.user_id::text)::uuid as user_id,
    min(e.cron_job_name) as cron_job_name,
    min(e.scheduled_for) filter (
      where e.delivery_status in ('sent', 'skipped')
    ) as scheduled_for,
    min(e.created_at) as first_event_at,
    max(e.created_at) as last_event_at,
    min(coalesce(e.cron_picked_at, e.function_started_at, e.created_at))
      filter (where e.delivery_status = 'picked') as first_picked_at,
    max(coalesce(e.cron_picked_at, e.function_started_at, e.created_at))
      filter (where e.delivery_status = 'picked') as last_picked_at,
    min(e.delivered_at) filter (
      where e.delivery_status in ('sent', 'skipped')
    ) as first_delivered_at,
    min(e.delivered_at) filter (
      where e.delivery_status = 'sent'
    ) as first_sent_at,
    max(e.delivered_at) filter (
      where e.delivery_status = 'sent'
    ) as last_sent_at,
    count(*)::bigint as raw_event_count,
    count(*) filter (where e.delivery_status = 'picked')::bigint
      as picked_count,
    count(*) filter (where e.delivery_status = 'sent')::bigint
      as sent_count,
    count(*) filter (where e.delivery_status = 'skipped')::bigint
      as skipped_count,
    count(*) filter (where e.delivery_status = 'failed')::bigint
      as failed_count,
    count(*) filter (where e.delivery_status = 'duplicate_guarded')::bigint
      as duplicate_guarded_count,
    count(e.delivery_latency_seconds) filter (
      where e.delivery_status = 'sent'
    )::bigint as sent_latency_count,
    coalesce(sum(e.delivery_latency_seconds::bigint) filter (
      where e.delivery_status = 'sent'
    ), 0)::bigint as sent_latency_sum_seconds,
    min(e.delivery_latency_seconds) filter (
      where e.delivery_status = 'sent'
    ) as min_sent_latency_seconds,
    max(e.delivery_latency_seconds) filter (
      where e.delivery_status = 'sent'
    ) as max_sent_latency_seconds,
    count(*) filter (
      where e.delivery_status = 'sent'
        and coalesce(
          e.delivery_latency_seconds > case
            when e.delivery_kind in ('reminder', 'scheduled_notification')
              then 90
            when e.delivery_kind = 'decan_reflection' then 420
            when e.delivery_kind in (
              'decan_opening',
              'drift_nudge',
              'strength_nudge'
            ) then 3600
            else 300
          end,
          false
        )
    )::bigint as late_sent_count
  from public.maat_delivery_timing_events e
  group by e.delivery_key
), mismatches as materialized (
  select coalesce(raw.delivery_key, ledger.delivery_key) as delivery_key
  from raw_by_key raw
  full join public.maat_delivery_ledger ledger using (delivery_key)
  where raw.delivery_key is null
     or ledger.delivery_key is null
     or raw.delivery_kind is distinct from ledger.delivery_kind
     or raw.target_table is distinct from ledger.target_table
     or raw.target_id is distinct from ledger.target_id
     or raw.user_id is distinct from ledger.user_id
     or raw.cron_job_name is distinct from ledger.cron_job_name
     or raw.scheduled_for is distinct from ledger.scheduled_for
     or raw.first_event_at is distinct from ledger.first_event_at
     or raw.last_event_at is distinct from ledger.last_event_at
     or raw.first_picked_at is distinct from ledger.first_picked_at
     or raw.last_picked_at is distinct from ledger.last_picked_at
     or raw.first_delivered_at is distinct from ledger.first_delivered_at
     or raw.first_sent_at is distinct from ledger.first_sent_at
     or raw.last_sent_at is distinct from ledger.last_sent_at
     or raw.raw_event_count is distinct from ledger.raw_event_count
     or raw.picked_count is distinct from ledger.picked_count
     or raw.sent_count is distinct from ledger.sent_count
     or raw.skipped_count is distinct from ledger.skipped_count
     or raw.failed_count is distinct from ledger.failed_count
     or raw.duplicate_guarded_count
       is distinct from ledger.duplicate_guarded_count
     or raw.sent_latency_count is distinct from ledger.sent_latency_count
     or raw.sent_latency_sum_seconds
       is distinct from ledger.sent_latency_sum_seconds
     or raw.min_sent_latency_seconds
       is distinct from ledger.min_sent_latency_seconds
     or raw.max_sent_latency_seconds
       is distinct from ledger.max_sent_latency_seconds
     or raw.late_sent_count is distinct from ledger.late_sent_count
), raw_totals as (
  select
    count(*)::bigint as delivery_keys,
    coalesce(sum(raw_event_count), 0)::bigint as raw_events,
    coalesce(sum(picked_count), 0)::bigint as picked_count,
    coalesce(sum(sent_count), 0)::bigint as sent_count,
    coalesce(sum(skipped_count), 0)::bigint as skipped_count,
    coalesce(sum(failed_count), 0)::bigint as failed_count,
    coalesce(sum(duplicate_guarded_count), 0)::bigint
      as duplicate_guarded_count,
    count(*) filter (where sent_count > 1)::bigint as duplicate_sent_keys,
    coalesce(sum(sent_latency_count), 0)::bigint as sent_latency_count,
    coalesce(sum(sent_latency_sum_seconds), 0)::bigint
      as sent_latency_sum_seconds,
    min(min_sent_latency_seconds) as min_sent_latency_seconds,
    max(max_sent_latency_seconds) as max_sent_latency_seconds,
    coalesce(sum(late_sent_count), 0)::bigint as late_sent_count,
    min(first_sent_at) as first_sent_at,
    max(last_sent_at) as last_sent_at
  from raw_by_key
), ledger_totals as (
  select
    count(*)::bigint as delivery_keys,
    coalesce(sum(raw_event_count), 0)::bigint as raw_events,
    coalesce(sum(picked_count), 0)::bigint as picked_count,
    coalesce(sum(sent_count), 0)::bigint as sent_count,
    coalesce(sum(skipped_count), 0)::bigint as skipped_count,
    coalesce(sum(failed_count), 0)::bigint as failed_count,
    coalesce(sum(duplicate_guarded_count), 0)::bigint
      as duplicate_guarded_count,
    count(*) filter (where sent_count > 1)::bigint as duplicate_sent_keys,
    coalesce(sum(sent_latency_count), 0)::bigint as sent_latency_count,
    coalesce(sum(sent_latency_sum_seconds), 0)::bigint
      as sent_latency_sum_seconds,
    min(min_sent_latency_seconds) as min_sent_latency_seconds,
    max(max_sent_latency_seconds) as max_sent_latency_seconds,
    coalesce(sum(late_sent_count), 0)::bigint as late_sent_count,
    min(first_sent_at) as first_sent_at,
    max(last_sent_at) as last_sent_at
  from public.maat_delivery_ledger
)
select jsonb_build_object(
  'snapshot', pg_current_snapshot()::text,
  'observed_at', clock_timestamp(),
  'raw', to_jsonb(raw_totals),
  'ledger', to_jsonb(ledger_totals),
  'mismatched_delivery_keys', (select count(*) from mismatches),
  'one_row_per_delivery_key',
    (select count(*) = count(distinct delivery_key)
     from public.maat_delivery_ledger)
) as maat_delivery_ledger_parity
from raw_totals, ledger_totals;
