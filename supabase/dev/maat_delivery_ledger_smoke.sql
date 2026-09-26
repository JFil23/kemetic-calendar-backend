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

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.maat_delivery_timing_events'::regclass
      and tgname = 'zz_maat_delivery_ledger_handoff_cleanup'
      and not tgisinternal
  ) then
    raise exception 'Cut 14 post-finalization handoff cleanup trigger is missing';
  end if;

  if to_regprocedure('private.backfill_maat_delivery_ledger(integer)') is null
     or to_regprocedure(
       'private.finalize_maat_delivery_ledger_backfill()'
     ) is null then
    raise exception 'Cut 14 resumable backfill functions are missing';
  end if;

  if not exists (
    select 1
    from private.maat_delivery_ledger_backfill_state
    where singleton
      and backfill_completed_at is not null
      and backfill_cursor_delivery_key is null
      and backfill_batches_completed = 0
      and baseline_delivery_keys_added = 0
      and baseline_raw_events_added = 0
  ) then
    raise exception 'Cut 14 clean replay must abandon and complete history';
  end if;
end
$$;

-- The production baseline is deliberately complete. Reopen only this
-- rollback-only smoke transaction to keep the legacy backfill mechanics
-- covered without reviving historical production work.
update private.maat_delivery_ledger_backfill_state
set backfill_started_at = null,
  backfill_completed_at = null,
  baseline_raw_events_added = 0,
  baseline_delivery_keys_added = 0,
  backfill_cursor_delivery_key = null,
  backfill_batches_completed = 0,
  last_batch_started_at = null,
  last_batch_completed_at = null,
  last_batch_delivery_keys = null,
  last_batch_raw_events = null
where singleton;

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
  ),
  (
    'cut14:historical-b',
    'scheduled_notification',
    'scheduled_notifications',
    'cut14-historical-b-target',
    null,
    '2026-01-01 01:10:00+00',
    null,
    '2026-01-01 01:10:05+00',
    null,
    'cut14_smoke_cron_b',
    1,
    'failed',
    null,
    'cut14-historical-b-failed',
    '{"cut14":"historical-b"}'::jsonb,
    '2026-01-01 01:10:10+00'
  ),
  (
    'cut14:historical-c',
    'scheduled_notification',
    'scheduled_notifications',
    'cut14-historical-c-target',
    null,
    '2026-01-01 01:20:00+00',
    '2026-01-01 01:20:10+00',
    '2026-01-01 01:20:05+00',
    null,
    'cut14_smoke_cron_c',
    1,
    'picked',
    null,
    null,
    '{"cut14":"historical-c"}'::jsonb,
    '2026-01-01 01:20:10+00'
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
select e.id, md5(row_to_json(e)::text) as fingerprint
from public.maat_delivery_timing_events e
where e.delivery_key like 'cut14:%';

-- Reject invalid bounds without changing state.
do $$
begin
  begin
    perform private.backfill_maat_delivery_ledger(0);
    raise exception 'zero-sized delivery-ledger batch unexpectedly succeeded';
  exception
    when others then
      if position('between 1 and 250' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;

-- Batch A: one whole key advances the cursor only after parity passes.
select private.backfill_maat_delivery_ledger(1);

do $$
begin
  if not exists (
    select 1
    from private.maat_delivery_ledger_backfill_state
    where singleton
      and backfill_cursor_delivery_key = 'cut14:historical'
      and backfill_batches_completed = 1
      and baseline_delivery_keys_added = 1
      and baseline_raw_events_added = 2
      and last_batch_delivery_keys = 1
      and last_batch_raw_events = 2
  ) then
    raise exception 'first bounded batch state is incorrect';
  end if;

  if exists (
    select 1 from private.maat_delivery_ledger_backfill_batch
  ) then
    raise exception 'successful first batch left staging rows behind';
  end if;
end
$$;

-- A conflicting live identity makes the next batch fail. The exception
-- subtransaction rolls the fixture insert back; cursor, ledger, and stage
-- must remain exactly at the last proven boundary.
do $$
declare
  v_cursor_before text;
  v_batches_before bigint;
  v_ledger_before text;
begin
  select backfill_cursor_delivery_key, backfill_batches_completed
    into v_cursor_before, v_batches_before
  from private.maat_delivery_ledger_backfill_state
  where singleton;

  select md5(coalesce(string_agg(row_to_json(l)::text, E'\n'
    order by l.delivery_key), ''))
    into v_ledger_before
  from public.maat_delivery_ledger l;

  begin
    insert into public.maat_delivery_timing_events (
      delivery_key,
      delivery_kind,
      target_table,
      target_id,
      cron_job_name,
      delivery_status,
      created_at
    ) values (
      'cut14:historical-b',
      'scheduled_notification',
      'scheduled_notifications',
      'cut14-historical-b-conflict',
      'cut14_smoke_cron_b',
      'picked',
      '2026-01-01 01:10:20+00'
    );

    perform private.backfill_maat_delivery_ledger(1);
    raise exception 'conflicting bounded batch unexpectedly succeeded';
  exception
    when others then
      if position('conflicts with a live ledger identity' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  if exists (
    select 1
    from private.maat_delivery_ledger_backfill_state
    where singleton
      and (
        backfill_cursor_delivery_key is distinct from v_cursor_before
        or backfill_batches_completed is distinct from v_batches_before
      )
  ) then
    raise exception 'failed batch advanced resumable state';
  end if;

  if v_ledger_before is distinct from (
    select md5(coalesce(string_agg(row_to_json(l)::text, E'\n'
      order by l.delivery_key), ''))
    from public.maat_delivery_ledger l
  ) then
    raise exception 'failed batch changed the ledger';
  end if;

  if exists (
    select 1 from private.maat_delivery_ledger_backfill_batch
  ) then
    raise exception 'failed batch left staging rows behind';
  end if;
end
$$;

-- Batch B retries the exact cursor boundary successfully.
select private.backfill_maat_delivery_ledger(1);

-- A live event for an already-processed key, while the global backfill is
-- still pending, is counted exactly once and remains in the handoff set.
insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  delivered_at,
  cron_job_name,
  delivery_attempt,
  delivery_status,
  metadata,
  created_at
) values (
  'cut14:historical-b',
  'scheduled_notification',
  'scheduled_notifications',
  'cut14-historical-b-target',
  '2026-01-01 01:10:00+00',
  '2026-01-01 01:10:30+00',
  'cut14_smoke_cron_b',
  2,
  'sent',
  '{"cut14":"historical-b-live"}'::jsonb,
  '2026-01-01 01:10:30+00'
);

-- Batch C proves the next whole key and completes the bounded baseline.
select private.backfill_maat_delivery_ledger(1);

create temporary table cut14_ledger_after_batches on commit drop as
select
  count(*)::bigint as row_count,
  md5(coalesce(string_agg(row_to_json(l)::text, E'\n' order by l.delivery_key), ''))
    as fingerprint
from public.maat_delivery_ledger l;

-- Exhausted retry is a no-op and does not implicitly finalize.
select private.backfill_maat_delivery_ledger(1);

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

  select * into strict v_row
  from public.maat_delivery_ledger
  where delivery_key = 'cut14:historical-b';

  if v_row.raw_event_count <> 2
     or v_row.failed_count <> 1
     or v_row.sent_count <> 1
     or v_row.sent_latency_count <> 1
     or v_row.sent_latency_sum_seconds <> 30 then
    raise exception 'processed-key live handoff is incorrect: %',
      row_to_json(v_row);
  end if;

  select * into strict v_row
  from public.maat_delivery_ledger
  where delivery_key = 'cut14:historical-c';

  if v_row.raw_event_count <> 1 or v_row.picked_count <> 1 then
    raise exception 'third bounded batch is incorrect: %', row_to_json(v_row);
  end if;

  if (
    select count(*)
    from public.maat_delivery_ledger
    where delivery_key in (
      'cut14:aggregate',
      'cut14:historical',
      'cut14:historical-b',
      'cut14:historical-c',
      'cut14:other'
    )
  ) <> 5 then
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
    from cut14_ledger_after_batches before
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
    raise exception 'exhausted batch retry changed the ledger';
  end if;

  if not exists (
    select 1
    from private.maat_delivery_ledger_backfill_state
    where singleton
      and backfill_completed_at is null
      and backfill_cursor_delivery_key = 'cut14:historical-c'
      and backfill_batches_completed = 3
      and baseline_delivery_keys_added = 3
      and baseline_raw_events_added = 4
      and last_batch_delivery_keys = 1
      and last_batch_raw_events = 1
  ) then
    raise exception 'resumable batch counters or cursor are incorrect';
  end if;

  if (
    select count(*)
    from private.maat_delivery_ledger_live_event_ids
    where delivery_key = 'cut14:historical-b'
  ) <> 1 then
    raise exception 'processed-key live event was not handed off exactly once';
  end if;

  if exists (
    select 1
    from cut14_raw_before before
    left join public.maat_delivery_timing_events event
      on event.id = before.id
    where event.id is null
       or md5(row_to_json(event)::text) is distinct from before.fingerprint
  ) then
    raise exception 'Cut 14 batch processing modified an existing raw row';
  end if;
end
$$;

select private.finalize_maat_delivery_ledger_backfill();

create temporary table cut14_ledger_after_finalize on commit drop as
select
  count(*)::bigint as row_count,
  md5(coalesce(string_agg(row_to_json(l)::text, E'\n' order by l.delivery_key), ''))
    as fingerprint
from public.maat_delivery_ledger l;

-- Finalization is separately idempotent.
select private.finalize_maat_delivery_ledger_backfill();

do $$
begin
  if not exists (
    select 1
    from private.maat_delivery_ledger_backfill_state
    where singleton
      and backfill_completed_at is not null
      and backfill_cursor_delivery_key = 'cut14:historical-c'
      and backfill_batches_completed = 3
      and baseline_delivery_keys_added = 3
      and baseline_raw_events_added = 4
  ) then
    raise exception 'bounded finalization state is incorrect';
  end if;

  if exists (
    select 1 from private.maat_delivery_ledger_backfill_batch
    union all
    select 1 from private.maat_delivery_ledger_live_event_ids
  ) then
    raise exception 'finalization did not clear stage and handoff rows';
  end if;

  if exists (
    select 1
    from cut14_ledger_after_finalize before
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
    raise exception 'idempotent finalization changed the ledger';
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
  ) <> 0 then
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

end
$$;

rollback;
