begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $$
declare
  v_timing_signature text;
  v_receipt_signature text;
begin
  select string_agg(
    column_name || ':' || udt_name,
    '|' order by ordinal_position
  ) into v_timing_signature
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'maat_delivery_timing_health';

  if v_timing_signature <> concat_ws('|',
    'delivery_kind:text',
    'cron_job_name:text',
    'picked_count:int8',
    'sent_count:int8',
    'skipped_count:int8',
    'failed_count:int8',
    'duplicate_guarded_count:int8',
    'duplicate_sent_key_count:int8',
    'last_event_at:timestamptz',
    'last_sent_at:timestamptz',
    'max_latency_seconds:int4',
    'avg_latency_seconds:numeric',
    'late_count:int8'
  ) then
    raise exception 'timing-health contract changed: %', v_timing_signature;
  end if;

  select string_agg(
    column_name || ':' || udt_name,
    '|' order by ordinal_position
  ) into v_receipt_signature
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'maat_delivery_receipt_health';

  if v_receipt_signature <> concat_ws('|',
    'delivery_key:text',
    'delivery_kind:text',
    'target_table:text',
    'target_id:text',
    'user_id:uuid',
    'scheduled_for:timestamptz',
    'sent_at:timestamptz',
    'server_delivery_latency_seconds:int4',
    'cron_job_name:text',
    'sent_count:int8',
    'skipped_count:int8',
    'first_received_at:timestamptz',
    'first_shown_at:timestamptz',
    'first_opened_at:timestamptz',
    'first_dismissed_at:timestamptz',
    'first_acted_at:timestamptz',
    'first_expired_at:timestamptz',
    'receipt_event_count:int8',
    'has_receipt:bool',
    'has_user_action:bool',
    'receipt_latency_seconds:int4',
    'open_latency_seconds:int4',
    'receipt_status:text'
  ) then
    raise exception 'receipt-health contract changed: %', v_receipt_signature;
  end if;

  if not coalesce(
    'security_invoker=true' = any (
      select unnest(reloptions)
      from pg_class
      where oid in (
        'public.maat_delivery_timing_health'::regclass,
        'public.maat_delivery_receipt_health'::regclass
      )
    ),
    false
  ) then
    raise exception 'Cut 15 health views lost security_invoker';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.maat_delivery_timing_health',
    'select'
  ) or not has_table_privilege(
    'service_role',
    'public.maat_delivery_receipt_health',
    'select'
  ) then
    raise exception 'service-role health-view grant changed';
  end if;

  if has_table_privilege(
    'anon',
    'public.maat_delivery_ledger',
    'select'
  ) or has_table_privilege(
    'authenticated',
    'public.maat_delivery_ledger',
    'select'
  ) then
    raise exception 'ledger became directly visible to a client role';
  end if;
end
$$;

-- The two aggregate readers must depend on the compact ledger, not the raw
-- event table. The explicitly event-level reader remains on raw history.
do $$
begin
  if not exists (
    select 1
    from pg_rewrite rewrite
    join pg_depend dependency on dependency.objid = rewrite.oid
    where rewrite.ev_class = 'public.maat_delivery_timing_health'::regclass
      and dependency.refobjid = 'public.maat_delivery_ledger'::regclass
  ) or exists (
    select 1
    from pg_rewrite rewrite
    join pg_depend dependency on dependency.objid = rewrite.oid
    where rewrite.ev_class = 'public.maat_delivery_timing_health'::regclass
      and dependency.refobjid =
        'public.maat_delivery_timing_events'::regclass
  ) then
    raise exception 'timing health has the wrong source dependency';
  end if;

  if not exists (
    select 1
    from pg_rewrite rewrite
    join pg_depend dependency on dependency.objid = rewrite.oid
    where rewrite.ev_class = 'public.maat_delivery_receipt_health'::regclass
      and dependency.refobjid = 'public.maat_delivery_ledger'::regclass
  ) or exists (
    select 1
    from pg_rewrite rewrite
    join pg_depend dependency on dependency.objid = rewrite.oid
    where rewrite.ev_class = 'public.maat_delivery_receipt_health'::regclass
      and dependency.refobjid =
        'public.maat_delivery_timing_events'::regclass
  ) then
    raise exception 'receipt health has the wrong server source dependency';
  end if;

  if not exists (
    select 1
    from pg_rewrite rewrite
    join pg_depend dependency on dependency.objid = rewrite.oid
    where rewrite.ev_class = 'public.maat_delivery_receipt_health'::regclass
      and dependency.refobjid =
        'public.maat_delivery_receipt_events'::regclass
  ) then
    raise exception 'receipt health lost receipt-event aggregation';
  end if;

  if not exists (
    select 1
    from pg_rewrite rewrite
    join pg_depend dependency on dependency.objid = rewrite.oid
    where rewrite.ev_class = 'public.maat_delivery_recent_events'::regclass
      and dependency.refobjid =
        'public.maat_delivery_timing_events'::regclass
  ) then
    raise exception 'recent events no longer uses raw timing events';
  end if;

  if not exists (
    select 1
    from pg_rewrite rewrite
    join pg_depend dependency on dependency.objid = rewrite.oid
    where rewrite.ev_class =
        'public.maat_delivery_push_release_blockers'::regclass
      and dependency.refobjid =
        'public.maat_delivery_recent_events'::regclass
  ) then
    raise exception 'push release blockers lost recent-events authority';
  end if;
end
$$;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  cron_picked_at,
  function_started_at,
  delivered_at,
  cron_job_name,
  delivery_attempt,
  delivery_status,
  skip_reason,
  error_code,
  metadata,
  created_at
) values
  (
    'cut15:ordinary', 'reminder', 'reminders', 'cut15-ordinary',
    now() - interval '11 minutes', now() - interval '10 minutes',
    now() - interval '10 minutes', null, 'cut15_health_smoke', 1,
    'picked', null, null, '{"cut15":"ordinary-picked"}',
    now() - interval '10 minutes'
  ),
  (
    'cut15:ordinary', 'reminder', 'reminders', 'cut15-ordinary',
    now() - interval '11 minutes', now() - interval '10 minutes',
    now() - interval '10 minutes', now() - interval '9 minutes',
    'cut15_health_smoke', 1, 'sent', null, null,
    '{"cut15":"ordinary-sent"}', now() - interval '9 minutes'
  ),
  (
    'cut15:skipped', 'reminder', 'reminders', 'cut15-skipped',
    now() - interval '9 minutes', null, now() - interval '8 minutes',
    null, 'cut15_health_smoke', 1, 'skipped', 'no-token', null,
    '{"cut15":"skipped"}', now() - interval '8 minutes'
  ),
  (
    'cut15:failed', 'reminder', 'reminders', 'cut15-failed',
    now() - interval '8 minutes', null, now() - interval '7 minutes',
    null, 'cut15_health_smoke', 1, 'failed', null, 'cut15-failure',
    '{"cut15":"failed"}', now() - interval '7 minutes'
  ),
  (
    'cut15:duplicate', 'reminder', 'reminders', 'cut15-duplicate',
    now() - interval '7 minutes', null, now() - interval '6 minutes',
    now() - interval '6 minutes', 'cut15_health_smoke', 1, 'sent',
    null, null, '{"cut15":"duplicate-first"}',
    now() - interval '6 minutes'
  ),
  (
    'cut15:duplicate', 'reminder', 'reminders', 'cut15-duplicate',
    now() - interval '7 minutes', null, now() - interval '5 minutes',
    now() - interval '5 minutes', 'cut15_health_smoke', 2, 'sent',
    null, null, '{"cut15":"duplicate-second"}',
    now() - interval '5 minutes'
  ),
  (
    'cut15:late', 'reminder', 'reminders', 'cut15-late',
    now() - interval '15 minutes', null, now() - interval '5 minutes',
    now() - interval '4 minutes', 'cut15_health_smoke', 1, 'sent',
    null, null, '{"cut15":"late"}', now() - interval '4 minutes'
  ),
  (
    'cut15:acted', 'reminder', 'reminders', 'cut15-acted',
    now() - interval '4 minutes', null, now() - interval '3 minutes',
    now() - interval '3 minutes', 'cut15_health_smoke', 1, 'sent',
    null, null, '{"cut15":"acted"}', now() - interval '3 minutes'
  ),
  (
    'cut15:missing', 'reminder', 'reminders', 'cut15-missing',
    now() - interval '25 minutes', null, now() - interval '24 minutes',
    now() - interval '20 minutes', 'cut15_health_smoke', 1, 'sent',
    null, null, '{"cut15":"missing"}', now() - interval '20 minutes'
  ),
  (
    'cut15:surface-missing', 'decan_opening',
    'maat_guidance_deliveries', 'cut15-surface-missing',
    now() - interval '3 hours', null, now() - interval '2 hours',
    now() - interval '2 hours', 'cut15_opening_smoke', 1, 'sent',
    null, null, '{"cut15":"surface-missing"}',
    now() - interval '2 hours'
  ),
  (
    'cut15:stale', 'reminder', 'reminders', 'cut15-stale',
    now() - interval '16 days', null, now() - interval '16 days',
    now() - interval '16 days', 'cut15_stale_smoke', 1, 'sent',
    null, null, '{"cut15":"stale"}', now() - interval '16 days'
  );

insert into public.maat_delivery_receipt_events (
  delivery_key,
  delivery_kind,
  device_id,
  platform,
  message_id,
  receipt_event,
  event_at,
  metadata
) values
  (
    'cut15:acted', 'reminder', 'cut15-device', 'ios',
    'cut15-message', 'received', now() - interval '150 seconds',
    '{"cut15":true}'
  ),
  (
    'cut15:acted', 'reminder', 'cut15-device', 'ios',
    'cut15-message', 'opened', now() - interval '120 seconds',
    '{"cut15":true}'
  ),
  (
    'cut15:acted', 'reminder', 'cut15-device', 'ios',
    'cut15-message', 'acted', now() - interval '90 seconds',
    '{"cut15":true}'
  );

create temporary table cut15_raw_timing_expected on commit drop as
with duplicate_sent_keys as (
  select event.delivery_key
  from public.maat_delivery_timing_events event
  where event.delivery_status = 'sent'
    and event.delivery_key like 'cut15:%'
    and event.created_at >= now() - interval '14 days'
  group by event.delivery_key
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
  round(avg(event.delivery_latency_seconds) filter (
    where event.delivery_status = 'sent'
  ), 2) as avg_latency_seconds,
  count(*) filter (
    where event.delivery_status = 'sent'
      and coalesce(
        event.delivery_latency_seconds > case
          when event.delivery_kind in ('reminder', 'scheduled_notification')
            then 90
          when event.delivery_kind = 'decan_reflection' then 420
          when event.delivery_kind in (
            'decan_opening', 'drift_nudge', 'strength_nudge'
          ) then 3600
          else 300
        end,
        false
      )
  ) as late_count
from public.maat_delivery_timing_events event
left join duplicate_sent_keys duplicate
  on duplicate.delivery_key = event.delivery_key
where event.delivery_key like 'cut15:%'
  and event.created_at >= now() - interval '14 days'
group by event.delivery_kind, event.cron_job_name;

do $$
begin
  if exists (
    (select * from cut15_raw_timing_expected
     except all
     select * from public.maat_delivery_timing_health
     where cron_job_name like 'cut15%')
    union all
    (select * from public.maat_delivery_timing_health
     where cron_job_name like 'cut15%'
     except all
     select * from cut15_raw_timing_expected)
  ) then
    raise exception 'raw and ledger timing-health aggregates differ';
  end if;

  if exists (
    select 1
    from public.maat_delivery_timing_health
    where cron_job_name = 'cut15_stale_smoke'
  ) then
    raise exception 'ledger health exceeded the 14-day operational horizon';
  end if;
end
$$;

create temporary table cut15_raw_receipt_expected on commit drop as
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
    and event.delivery_key like 'cut15:%'
    and event.created_at >= now() - interval '14 days'
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
  where receipt.delivery_key like 'cut15:%'
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
      'reminder', 'scheduled_notification', 'decan_reflection', 'push_test'
    ) and receipt.first_received_at is not null then greatest(
      0,
      floor(extract(epoch from receipt.first_received_at - sent.sent_at))::integer
    )
    when sent.delivery_kind in (
      'decan_opening', 'drift_nudge', 'strength_nudge', 'maat_guidance'
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
      'reminder', 'scheduled_notification', 'decan_reflection', 'push_test'
    ) and now() - sent.sent_at > interval '15 minutes' then 'receipt_missing'
    when sent.delivery_kind in (
      'decan_opening', 'drift_nudge', 'strength_nudge', 'maat_guidance'
    ) and now() - sent.sent_at > interval '1 hour' then 'surface_missing'
    else 'awaiting_receipt'
  end as receipt_status
from sent_events sent
left join receipt_events receipt
  on receipt.delivery_key = sent.delivery_key;

do $$
begin
  if exists (
    (select * from cut15_raw_receipt_expected
     except all
     select * from public.maat_delivery_receipt_health
     where delivery_key like 'cut15:%')
    union all
    (select * from public.maat_delivery_receipt_health
     where delivery_key like 'cut15:%'
     except all
     select * from cut15_raw_receipt_expected)
  ) then
    raise exception 'raw and ledger receipt-health results differ';
  end if;

  if not exists (
    select 1 from public.maat_delivery_receipt_health
    where delivery_key = 'cut15:acted'
      and receipt_status = 'acted'
      and receipt_event_count = 3
      and has_receipt
      and has_user_action
  ) or not exists (
    select 1 from public.maat_delivery_receipt_health
    where delivery_key = 'cut15:missing'
      and receipt_status = 'receipt_missing'
  ) or not exists (
    select 1 from public.maat_delivery_receipt_health
    where delivery_key = 'cut15:surface-missing'
      and receipt_status = 'surface_missing'
  ) or not exists (
    select 1 from public.maat_delivery_receipt_health
    where delivery_key = 'cut15:skipped'
      and receipt_status = 'not_sent'
  ) then
    raise exception 'receipt status transition contract changed';
  end if;

  if not exists (
    select 1 from public.maat_delivery_alerts
    where source = 'delivery_timing'
      and subject = 'cut15_health_smoke/reminder'
  ) or not exists (
    select 1 from public.maat_delivery_alerts
    where source = 'delivery_receipt'
      and subject = 'cut15:missing'
  ) or not exists (
    select 1 from public.maat_delivery_alerts
    where source = 'delivery_receipt'
      and subject = 'cut15:surface-missing'
  ) then
    raise exception 'ledger-backed alert behavior changed';
  end if;
end
$$;

rollback;
