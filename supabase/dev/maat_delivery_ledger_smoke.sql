begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

create temporary table cut14_reader_definitions_before on commit drop as
select c.oid, c.relname, pg_get_viewdef(c.oid, true) as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'maat_delivery_recent_events',
    'maat_delivery_timing_health',
    'maat_delivery_receipt_health',
    'maat_delivery_alerts'
  );

do $$
begin
  if to_regclass('public.maat_delivery_ledger') is null then
    raise exception 'Cut 14 ledger table is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.maat_delivery_timing_events'::regclass
      and tgname = 'maat_delivery_ledger_sync'
      and not tgisinternal
  ) then
    raise exception 'Cut 14 raw-insert synchronization trigger is missing';
  end if;

  if (
    select backfill_completed_at is not null
    from private.maat_delivery_ledger_backfill_state
    where singleton
  ) then
    raise exception 'Cut 14 clean-replay ledger must begin pending backfill';
  end if;
end
$$;

-- Historical rows simulate raw history that predates trigger activation.
alter table public.maat_delivery_timing_events
  disable trigger maat_delivery_ledger_sync;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  user_id,
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
    'cut14:historical',
    'scheduled_notification',
    'scheduled_notifications',
    'cut14-historical-target',
    null,
    '2026-01-01 01:00:00+00',
    '2026-01-01 01:00:10+00',
    '2026-01-01 01:00:05+00',
    null,
    'cut14_smoke_cron',
    1,
    'picked',
    null,
    null,
    '{"cut14":"historical-picked"}'::jsonb,
    '2026-01-01 01:00:10+00'
  ),
  (
    'cut14:historical',
    'scheduled_notification',
    'scheduled_notifications',
    'cut14-historical-target',
    null,
    '2026-01-01 01:00:00+00',
    '2026-01-01 01:00:10+00',
    '2026-01-01 01:00:05+00',
    '2026-01-01 01:01:20+00',
    'cut14_smoke_cron',
    1,
    'sent',
    null,
    null,
    '{"cut14":"historical-sent"}'::jsonb,
    '2026-01-01 01:01:20+00'
  );

alter table public.maat_delivery_timing_events
  enable trigger maat_delivery_ledger_sync;

-- First live raw event creates exactly one ledger row.
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
  metadata,
  created_at
) values (
  'cut14:aggregate',
  'reminder',
  'reminders',
  'cut14-aggregate-target',
  '2026-01-01 00:00:00+00',
  '2026-01-01 00:00:10+00',
  '2026-01-01 00:00:05+00',
  null,
  'cut14_smoke_cron',
  1,
  'picked',
  '{"cut14":"picked"}'::jsonb,
  '2026-01-01 00:00:10+00'
);

do $$
begin
  if (
    select count(*)
    from public.maat_delivery_ledger
    where delivery_key = 'cut14:aggregate'
  ) <> 1 then
    raise exception 'first raw event did not create exactly one ledger row';
  end if;

  if (
    select raw_event_count
    from public.maat_delivery_ledger
    where delivery_key = 'cut14:aggregate'
  ) <> 1 then
    raise exception 'first raw event was not counted exactly once';
  end if;
end
$$;

-- More events for the same key must update, not multiply, the ledger row.
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
    'cut14:aggregate', 'reminder', 'reminders', 'cut14-aggregate-target',
    '2026-01-01 00:00:00+00', null, '2026-01-01 00:00:20+00',
    '2026-01-01 00:01:40+00', 'cut14_smoke_cron', 2, 'sent',
    null, null, '{"cut14":"sent-late"}'::jsonb,
    '2026-01-01 00:01:40+00'
  ),
  (
    'cut14:aggregate', 'reminder', 'reminders', 'cut14-aggregate-target',
    '2026-01-01 00:00:00+00', null, '2026-01-01 00:00:20+00',
    '2026-01-01 00:00:50+00', 'cut14_smoke_cron', 3, 'sent',
    null, null, '{"cut14":"sent-duplicate"}'::jsonb,
    '2026-01-01 00:03:20+00'
  ),
  (
    'cut14:aggregate', 'reminder', 'reminders', 'cut14-aggregate-target',
    '2026-01-01 00:00:00+00', null, '2026-01-01 00:00:20+00',
    null, 'cut14_smoke_cron', 4, 'skipped',
    'cut14-skip', null, '{"cut14":"skipped"}'::jsonb,
    '2026-01-01 00:05:00+00'
  ),
  (
    'cut14:aggregate', 'reminder', 'reminders', 'cut14-aggregate-target',
    '2026-01-01 00:00:00+00', null, '2026-01-01 00:00:20+00',
    null, 'cut14_smoke_cron', 5, 'failed',
    'cut14-latest-reason', 'cut14-latest-error',
    '{"cut14":"latest-failed"}'::jsonb,
    '2026-01-01 00:07:30+00'
  ),
  (
    'cut14:aggregate', 'reminder', 'reminders', 'cut14-aggregate-target',
    '2026-01-01 00:00:00+00', null, '2026-01-01 00:00:20+00',
    null, 'cut14_smoke_cron', 6, 'duplicate_guarded',
    null, null, '{"cut14":"out-of-order"}'::jsonb,
    '2026-01-01 00:06:40+00'
  );

-- A different key creates a second ledger row.
insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  cron_job_name,
  delivery_status,
  metadata,
  created_at
) values (
  'cut14:other',
  'decan_opening',
  'maat_guidance_deliveries',
  'cut14-other-target',
  'cut14_smoke_cron_other',
  'skipped',
  '{"cut14":"other"}'::jsonb,
  '2026-01-01 02:00:00+00'
);

-- One live event for a historical key is captured by id. The backfill must
-- add the two old rows but exclude this already-counted row.
insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  cron_job_name,
  delivery_attempt,
  delivery_status,
  skip_reason,
  metadata,
  created_at
) values (
  'cut14:historical',
  'scheduled_notification',
  'scheduled_notifications',
  'cut14-historical-target',
  '2026-01-01 01:00:00+00',
  'cut14_smoke_cron',
  2,
  'skipped',
  'cut14-live-during-backfill-window',
  '{"cut14":"live-before-backfill"}'::jsonb,
  '2026-01-01 01:02:00+00'
);

create temporary table cut14_raw_before on commit drop as
select
  count(*)::bigint as row_count,
  md5(coalesce(string_agg(row_to_json(e)::text, E'\n' order by e.id), ''))
    as fingerprint
from public.maat_delivery_timing_events e
where e.delivery_key like 'cut14:%';

select private.backfill_maat_delivery_ledger();

create temporary table cut14_ledger_after_first_backfill on commit drop as
select
  count(*)::bigint as row_count,
  md5(coalesce(string_agg(row_to_json(l)::text, E'\n' order by l.delivery_key), ''))
    as fingerprint
from public.maat_delivery_ledger l;

-- Idempotent retry must be a no-op.
select private.backfill_maat_delivery_ledger();

do $$
declare
  v_row public.maat_delivery_ledger%rowtype;
begin
  select * into strict v_row
  from public.maat_delivery_ledger
  where delivery_key = 'cut14:aggregate';

  if v_row.raw_event_count <> 6
     or v_row.picked_count <> 1
     or v_row.sent_count <> 2
     or v_row.skipped_count <> 1
     or v_row.failed_count <> 1
     or v_row.duplicate_guarded_count <> 1
     or v_row.duplicate_sent_count <> 1 then
    raise exception 'Cut 14 status counts are incorrect: %', row_to_json(v_row);
  end if;

  if v_row.sent_latency_count <> 2
     or v_row.sent_latency_sum_seconds <> 150
     or v_row.min_sent_latency_seconds <> 50
     or v_row.max_sent_latency_seconds <> 100
     or v_row.late_sent_count <> 1 then
    raise exception 'Cut 14 sent latency aggregates are incorrect: %',
      row_to_json(v_row);
  end if;

  if v_row.first_picked_at <> '2026-01-01 00:00:10+00'::timestamptz
     or v_row.first_sent_at <> '2026-01-01 00:00:50+00'::timestamptz
     or v_row.last_sent_at <> '2026-01-01 00:01:40+00'::timestamptz then
    raise exception 'Cut 14 earliest/latest timing is incorrect: %',
      row_to_json(v_row);
  end if;

  if v_row.latest_delivery_status <> 'failed'
     or v_row.latest_delivery_attempt <> 5
     or v_row.latest_skip_reason <> 'cut14-latest-reason'
     or v_row.latest_error_code <> 'cut14-latest-error'
     or v_row.latest_metadata <> '{"cut14":"latest-failed"}'::jsonb then
    raise exception 'out-of-order event regressed latest ledger state: %',
      row_to_json(v_row);
  end if;

  select * into strict v_row
  from public.maat_delivery_ledger
  where delivery_key = 'cut14:historical';

  if v_row.raw_event_count <> 3
     or v_row.picked_count <> 1
     or v_row.sent_count <> 1
     or v_row.skipped_count <> 1 then
    raise exception 'backfill/live handoff lost or doubled an event: %',
      row_to_json(v_row);
  end if;

  if (
    select count(*)
    from public.maat_delivery_ledger
    where delivery_key in ('cut14:aggregate', 'cut14:historical', 'cut14:other')
  ) <> 3 then
    raise exception 'one-row-per-delivery-key grain was not preserved';
  end if;

  if exists (
    select 1
    from public.maat_delivery_ledger
    group by delivery_key
    having count(*) > 1
  ) then
    raise exception 'duplicate delivery_key exists in Cut 14 ledger';
  end if;

  if exists (
    select 1
    from cut14_ledger_after_first_backfill before
    cross join lateral (
      select
        count(*)::bigint as row_count,
        md5(coalesce(string_agg(row_to_json(l)::text, E'\n'
          order by l.delivery_key), '')) as fingerprint
      from public.maat_delivery_ledger l
    ) after
    where before.row_count is distinct from after.row_count
       or before.fingerprint is distinct from after.fingerprint
  ) then
    raise exception 'idempotent backfill retry changed the ledger';
  end if;

  if exists (
    select 1
    from cut14_raw_before before
    cross join lateral (
      select
        count(*)::bigint as row_count,
        md5(coalesce(string_agg(row_to_json(e)::text, E'\n'
          order by e.id), '')) as fingerprint
      from public.maat_delivery_timing_events e
      where e.delivery_key like 'cut14:%'
    ) after
    where before.row_count is distinct from after.row_count
       or before.fingerprint is distinct from after.fingerprint
  ) then
    raise exception 'Cut 14 backfill modified raw timing rows';
  end if;
end
$$;

-- Once backfill is complete, future events increment directly and no longer
-- need a handoff id.
insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  cron_job_name,
  delivery_status,
  error_code,
  metadata,
  created_at
) values (
  'cut14:historical',
  'scheduled_notification',
  'scheduled_notifications',
  'cut14-historical-target',
  'cut14_smoke_cron',
  'failed',
  'cut14-post-backfill',
  '{"cut14":"post-backfill"}'::jsonb,
  '2026-01-01 01:03:00+00'
);

do $$
begin
  if (
    select raw_event_count
    from public.maat_delivery_ledger
    where delivery_key = 'cut14:historical'
  ) <> 4 then
    raise exception 'post-backfill raw event was not synchronized';
  end if;

  if (
    select count(*)
    from private.maat_delivery_ledger_live_event_ids
    where delivery_key = 'cut14:historical'
  ) <> 1 then
    raise exception 'post-backfill event incorrectly entered handoff table';
  end if;
end
$$;

-- Stable identity fields may not silently drift. The rejected raw insert and
-- its trigger work are rolled back by the PL/pgSQL exception subtransaction.
do $$
begin
  begin
    insert into public.maat_delivery_timing_events (
      delivery_key,
      delivery_kind,
      target_table,
      target_id,
      cron_job_name,
      delivery_status
    ) values (
      'cut14:aggregate',
      'reminder',
      'reminders',
      'cut14-conflicting-target',
      'cut14_smoke_cron',
      'picked'
    );

    raise exception 'identity drift insert unexpectedly succeeded';
  exception
    when others then
      if position('identity drift' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.maat_delivery_timing_events
    where delivery_key = 'cut14:aggregate'
      and target_id = 'cut14-conflicting-target'
  ) then
    raise exception 'rejected identity drift left a raw row behind';
  end if;
end
$$;

do $$
begin
  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.maat_delivery_ledger'::regclass
  ) then
    raise exception 'Cut 14 ledger RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.maat_delivery_ledger', 'select')
     or has_table_privilege(
       'authenticated', 'public.maat_delivery_ledger', 'select'
     ) then
    raise exception 'Cut 14 ledger is exposed to client roles';
  end if;

  if not has_table_privilege(
    'service_role', 'public.maat_delivery_ledger', 'select'
  ) then
    raise exception 'service_role lost operational ledger access';
  end if;

  if exists (
    select 1
    from cut14_reader_definitions_before before
    join pg_class c on c.oid = before.oid
    where pg_get_viewdef(c.oid, true) is distinct from before.definition
  ) then
    raise exception 'Cut 14 changed an existing delivery reader definition';
  end if;

  if exists (
    select 1
    from cut14_reader_definitions_before before
    where before.definition like '%maat_delivery_ledger%'
  ) then
    raise exception 'Cut 14 moved a reader to the ledger before Cut 15';
  end if;
end
$$;

rollback;
