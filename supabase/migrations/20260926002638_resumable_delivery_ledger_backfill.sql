begin;

-- Cut 14 follow-up: replace the production-infeasible one-shot historical
-- scan with resumable, whole-delivery-key batches. The live raw-insert
-- trigger remains authoritative for post-install events throughout.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table private.maat_delivery_ledger_backfill_state
  add column backfill_cursor_delivery_key text,
  add column backfill_batches_completed bigint not null default 0,
  add column last_batch_started_at timestamp with time zone,
  add column last_batch_completed_at timestamp with time zone,
  add column last_batch_delivery_keys integer,
  add column last_batch_raw_events bigint;

alter table private.maat_delivery_ledger_backfill_state
  add constraint maat_delivery_ledger_backfill_batches_nonnegative check (
    backfill_batches_completed >= 0
  ),
  add constraint maat_delivery_ledger_last_batch_keys_nonnegative check (
    last_batch_delivery_keys is null or last_batch_delivery_keys >= 0
  ),
  add constraint maat_delivery_ledger_last_batch_events_nonnegative check (
    last_batch_raw_events is null or last_batch_raw_events >= 0
  );

-- A trigger that started just before finalization can observe the old pending
-- state, then resume after the finalizer commits. This second AFTER trigger
-- runs after maat_delivery_ledger_sync and removes only that event's handoff
-- row once the completed state is visible. It is otherwise a no-op.
create or replace function private.cleanup_maat_delivery_ledger_live_event_id()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if exists (
    select 1
    from private.maat_delivery_ledger_backfill_state state
    where state.singleton
      and state.backfill_completed_at is not null
  ) then
    delete from private.maat_delivery_ledger_live_event_ids live
    where live.event_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function private.cleanup_maat_delivery_ledger_live_event_id()
  from public, anon, authenticated;

drop trigger if exists zz_maat_delivery_ledger_handoff_cleanup
  on public.maat_delivery_timing_events;

create trigger zz_maat_delivery_ledger_handoff_cleanup
after insert on public.maat_delivery_timing_events
for each row
execute function private.cleanup_maat_delivery_ledger_live_event_id();

drop function private.backfill_maat_delivery_ledger();

create function private.backfill_maat_delivery_ledger(
  p_batch_size integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_state private.maat_delivery_ledger_backfill_state%rowtype;
  v_delivery_keys text[];
  v_next_cursor text;
  v_batch_started_at timestamp with time zone := clock_timestamp();
  v_batch_completed_at timestamp with time zone;
  v_batch_keys integer;
  v_batch_events bigint;
  v_parity_mismatches bigint;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 250 then
    raise exception 'maat delivery ledger batch size must be between 1 and 250';
  end if;

  select state.*
    into strict v_state
  from private.maat_delivery_ledger_backfill_state state
  where state.singleton
  for update;

  if v_state.backfill_completed_at is not null then
    return jsonb_build_object(
      'already_completed', true,
      'backfill_completed_at', v_state.backfill_completed_at,
      'backfill_cursor_delivery_key',
        v_state.backfill_cursor_delivery_key,
      'backfill_batches_completed', v_state.backfill_batches_completed,
      'baseline_raw_events_added', v_state.baseline_raw_events_added,
      'baseline_delivery_keys_added', v_state.baseline_delivery_keys_added
    );
  end if;

  truncate table private.maat_delivery_ledger_backfill_batch;

  -- Branching keeps the post-first-batch query on a true indexed key range
  -- rather than an OR predicate that can degrade to scanning earlier keys.
  if v_state.backfill_cursor_delivery_key is null then
    select array_agg(next_key.delivery_key order by next_key.delivery_key)
      into v_delivery_keys
    from (
      select event.delivery_key
      from public.maat_delivery_timing_events event
      where not exists (
        select 1
        from private.maat_delivery_ledger_live_event_ids live
        where live.event_id = event.id
      )
      group by event.delivery_key
      order by event.delivery_key
      limit p_batch_size
    ) next_key;
  else
    select array_agg(next_key.delivery_key order by next_key.delivery_key)
      into v_delivery_keys
    from (
      select event.delivery_key
      from public.maat_delivery_timing_events event
      where event.delivery_key > v_state.backfill_cursor_delivery_key
        and not exists (
          select 1
          from private.maat_delivery_ledger_live_event_ids live
          where live.event_id = event.id
        )
      group by event.delivery_key
      order by event.delivery_key
      limit p_batch_size
    ) next_key;
  end if;

  v_batch_keys := coalesce(cardinality(v_delivery_keys), 0);

  if v_batch_keys = 0 then
    return jsonb_build_object(
      'already_completed', false,
      'batch_exhausted', true,
      'batch_delivery_keys', 0,
      'batch_raw_events', 0,
      'backfill_cursor_delivery_key',
        v_state.backfill_cursor_delivery_key,
      'backfill_batches_completed', v_state.backfill_batches_completed,
      'baseline_raw_events_added', v_state.baseline_raw_events_added,
      'baseline_delivery_keys_added', v_state.baseline_delivery_keys_added,
      'finalization_required', true
    );
  end if;

  v_next_cursor := v_delivery_keys[v_batch_keys];

  with selected_keys as materialized (
    select unnest(v_delivery_keys) as delivery_key
  ), batch_rows as materialized (
    select event.*
    from selected_keys selected
    join public.maat_delivery_timing_events event
      on event.delivery_key = selected.delivery_key
    where not exists (
      select 1
      from private.maat_delivery_ledger_live_event_ids live
      where live.event_id = event.id
    )
  )
  insert into private.maat_delivery_ledger_backfill_batch (
    delivery_key,
    delivery_kind,
    max_delivery_kind,
    target_table,
    max_target_table,
    target_id,
    max_target_id,
    user_id,
    user_id_values,
    cron_job_name,
    max_cron_job_name,
    scheduled_for,
    first_event_at,
    last_event_at,
    first_picked_at,
    last_picked_at,
    first_delivered_at,
    first_sent_at,
    last_sent_at,
    raw_event_count,
    picked_count,
    sent_count,
    skipped_count,
    failed_count,
    duplicate_guarded_count,
    sent_latency_count,
    sent_latency_sum_seconds,
    min_sent_latency_seconds,
    max_sent_latency_seconds,
    late_sent_count
  )
  select
    event.delivery_key,
    min(event.delivery_kind),
    max(event.delivery_kind),
    min(event.target_table),
    max(event.target_table),
    min(event.target_id),
    max(event.target_id),
    min(event.user_id::text)::uuid,
    count(distinct coalesce(event.user_id::text, '<null>')),
    min(event.cron_job_name),
    max(event.cron_job_name),
    min(event.scheduled_for) filter (
      where event.delivery_status in ('sent', 'skipped')
    ),
    min(event.created_at),
    max(event.created_at),
    min(coalesce(
      event.cron_picked_at,
      event.function_started_at,
      event.created_at
    )) filter (where event.delivery_status = 'picked'),
    max(coalesce(
      event.cron_picked_at,
      event.function_started_at,
      event.created_at
    )) filter (where event.delivery_status = 'picked'),
    min(event.delivered_at) filter (
      where event.delivery_status in ('sent', 'skipped')
    ),
    min(event.delivered_at) filter (where event.delivery_status = 'sent'),
    max(event.delivered_at) filter (where event.delivery_status = 'sent'),
    count(*)::bigint,
    count(*) filter (where event.delivery_status = 'picked')::bigint,
    count(*) filter (where event.delivery_status = 'sent')::bigint,
    count(*) filter (where event.delivery_status = 'skipped')::bigint,
    count(*) filter (where event.delivery_status = 'failed')::bigint,
    count(*) filter (
      where event.delivery_status = 'duplicate_guarded'
    )::bigint,
    count(event.delivery_latency_seconds) filter (
      where event.delivery_status = 'sent'
    )::bigint,
    coalesce(sum(event.delivery_latency_seconds::bigint) filter (
      where event.delivery_status = 'sent'
    ), 0)::bigint,
    min(event.delivery_latency_seconds) filter (
      where event.delivery_status = 'sent'
    ),
    max(event.delivery_latency_seconds) filter (
      where event.delivery_status = 'sent'
    ),
    count(*) filter (
      where event.delivery_status = 'sent'
        and coalesce(
          event.delivery_latency_seconds > case
            when event.delivery_kind in (
              'reminder',
              'scheduled_notification'
            ) then 90
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
    )::bigint
  from batch_rows event
  group by event.delivery_key;

  if (
    select count(*)
    from private.maat_delivery_ledger_backfill_batch
  ) <> v_batch_keys then
    raise exception 'maat delivery ledger batch lost a selected delivery key';
  end if;

  if exists (
    select 1
    from private.maat_delivery_ledger_backfill_batch base
    where base.delivery_kind is distinct from base.max_delivery_kind
       or base.target_table is distinct from base.max_target_table
       or base.target_id is distinct from base.max_target_id
       or base.user_id_values > 1
       or base.cron_job_name is distinct from base.max_cron_job_name
  ) then
    raise exception 'maat delivery ledger batch found identity drift';
  end if;

  if exists (
    select 1
    from private.maat_delivery_ledger_backfill_batch base
    join public.maat_delivery_ledger ledger using (delivery_key)
    where ledger.delivery_kind is distinct from base.delivery_kind
       or ledger.target_table is distinct from base.target_table
       or ledger.target_id is distinct from base.target_id
       or ledger.user_id is distinct from base.user_id
       or ledger.cron_job_name is distinct from base.cron_job_name
  ) then
    raise exception
      'maat delivery ledger batch conflicts with a live ledger identity';
  end if;

  select coalesce(sum(base.raw_event_count), 0)
    into v_batch_events
  from private.maat_delivery_ledger_backfill_batch base;

  with batch_rows as materialized (
    select event.*
    from private.maat_delivery_ledger_backfill_batch base
    join public.maat_delivery_timing_events event using (delivery_key)
    where not exists (
      select 1
      from private.maat_delivery_ledger_live_event_ids live
      where live.event_id = event.id
    )
  ), latest_rows as materialized (
    select distinct on (event.delivery_key)
      event.*
    from batch_rows event
    order by event.delivery_key, event.created_at desc, event.id desc
  )
  insert into public.maat_delivery_ledger (
    delivery_key,
    delivery_kind,
    target_table,
    target_id,
    user_id,
    cron_job_name,
    scheduled_for,
    first_event_at,
    last_event_at,
    last_event_id,
    first_picked_at,
    last_picked_at,
    first_delivered_at,
    first_sent_at,
    last_sent_at,
    raw_event_count,
    picked_count,
    sent_count,
    skipped_count,
    failed_count,
    duplicate_guarded_count,
    sent_latency_count,
    sent_latency_sum_seconds,
    min_sent_latency_seconds,
    max_sent_latency_seconds,
    late_sent_count,
    latest_delivery_status,
    latest_delivery_attempt,
    latest_skip_reason,
    latest_error_code,
    latest_scheduled_for,
    latest_cron_picked_at,
    latest_function_started_at,
    latest_delivered_at,
    latest_delivery_latency_seconds,
    latest_metadata
  )
  select
    base.delivery_key,
    base.delivery_kind,
    base.target_table,
    base.target_id,
    base.user_id,
    base.cron_job_name,
    base.scheduled_for,
    base.first_event_at,
    base.last_event_at,
    latest.id,
    base.first_picked_at,
    base.last_picked_at,
    base.first_delivered_at,
    base.first_sent_at,
    base.last_sent_at,
    base.raw_event_count,
    base.picked_count,
    base.sent_count,
    base.skipped_count,
    base.failed_count,
    base.duplicate_guarded_count,
    base.sent_latency_count,
    base.sent_latency_sum_seconds,
    base.min_sent_latency_seconds,
    base.max_sent_latency_seconds,
    base.late_sent_count,
    latest.delivery_status,
    latest.delivery_attempt,
    latest.skip_reason,
    latest.error_code,
    latest.scheduled_for,
    latest.cron_picked_at,
    latest.function_started_at,
    latest.delivered_at,
    latest.delivery_latency_seconds,
    latest.metadata
  from private.maat_delivery_ledger_backfill_batch base
  join latest_rows latest using (delivery_key)
  on conflict (delivery_key) do update
  set
    scheduled_for = case
      when maat_delivery_ledger.scheduled_for is null
        then excluded.scheduled_for
      when excluded.scheduled_for is null
        then maat_delivery_ledger.scheduled_for
      else least(maat_delivery_ledger.scheduled_for, excluded.scheduled_for)
    end,
    first_event_at = least(
      maat_delivery_ledger.first_event_at,
      excluded.first_event_at
    ),
    last_event_at = greatest(
      maat_delivery_ledger.last_event_at,
      excluded.last_event_at
    ),
    last_event_id = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.last_event_id
      else maat_delivery_ledger.last_event_id
    end,
    first_picked_at = case
      when maat_delivery_ledger.first_picked_at is null
        then excluded.first_picked_at
      when excluded.first_picked_at is null
        then maat_delivery_ledger.first_picked_at
      else least(
        maat_delivery_ledger.first_picked_at,
        excluded.first_picked_at
      )
    end,
    last_picked_at = case
      when maat_delivery_ledger.last_picked_at is null
        then excluded.last_picked_at
      when excluded.last_picked_at is null
        then maat_delivery_ledger.last_picked_at
      else greatest(
        maat_delivery_ledger.last_picked_at,
        excluded.last_picked_at
      )
    end,
    first_delivered_at = case
      when maat_delivery_ledger.first_delivered_at is null
        then excluded.first_delivered_at
      when excluded.first_delivered_at is null
        then maat_delivery_ledger.first_delivered_at
      else least(
        maat_delivery_ledger.first_delivered_at,
        excluded.first_delivered_at
      )
    end,
    first_sent_at = case
      when maat_delivery_ledger.first_sent_at is null
        then excluded.first_sent_at
      when excluded.first_sent_at is null
        then maat_delivery_ledger.first_sent_at
      else least(maat_delivery_ledger.first_sent_at, excluded.first_sent_at)
    end,
    last_sent_at = case
      when maat_delivery_ledger.last_sent_at is null
        then excluded.last_sent_at
      when excluded.last_sent_at is null
        then maat_delivery_ledger.last_sent_at
      else greatest(maat_delivery_ledger.last_sent_at, excluded.last_sent_at)
    end,
    raw_event_count = maat_delivery_ledger.raw_event_count
      + excluded.raw_event_count,
    picked_count = maat_delivery_ledger.picked_count + excluded.picked_count,
    sent_count = maat_delivery_ledger.sent_count + excluded.sent_count,
    skipped_count = maat_delivery_ledger.skipped_count + excluded.skipped_count,
    failed_count = maat_delivery_ledger.failed_count + excluded.failed_count,
    duplicate_guarded_count = maat_delivery_ledger.duplicate_guarded_count
      + excluded.duplicate_guarded_count,
    sent_latency_count = maat_delivery_ledger.sent_latency_count
      + excluded.sent_latency_count,
    sent_latency_sum_seconds = maat_delivery_ledger.sent_latency_sum_seconds
      + excluded.sent_latency_sum_seconds,
    min_sent_latency_seconds = case
      when maat_delivery_ledger.min_sent_latency_seconds is null
        then excluded.min_sent_latency_seconds
      when excluded.min_sent_latency_seconds is null
        then maat_delivery_ledger.min_sent_latency_seconds
      else least(
        maat_delivery_ledger.min_sent_latency_seconds,
        excluded.min_sent_latency_seconds
      )
    end,
    max_sent_latency_seconds = case
      when maat_delivery_ledger.max_sent_latency_seconds is null
        then excluded.max_sent_latency_seconds
      when excluded.max_sent_latency_seconds is null
        then maat_delivery_ledger.max_sent_latency_seconds
      else greatest(
        maat_delivery_ledger.max_sent_latency_seconds,
        excluded.max_sent_latency_seconds
      )
    end,
    late_sent_count = maat_delivery_ledger.late_sent_count
      + excluded.late_sent_count,
    latest_delivery_status = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_delivery_status
      else maat_delivery_ledger.latest_delivery_status
    end,
    latest_delivery_attempt = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_delivery_attempt
      else maat_delivery_ledger.latest_delivery_attempt
    end,
    latest_skip_reason = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_skip_reason
      else maat_delivery_ledger.latest_skip_reason
    end,
    latest_error_code = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_error_code
      else maat_delivery_ledger.latest_error_code
    end,
    latest_scheduled_for = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_scheduled_for
      else maat_delivery_ledger.latest_scheduled_for
    end,
    latest_cron_picked_at = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_cron_picked_at
      else maat_delivery_ledger.latest_cron_picked_at
    end,
    latest_function_started_at = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_function_started_at
      else maat_delivery_ledger.latest_function_started_at
    end,
    latest_delivered_at = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_delivered_at
      else maat_delivery_ledger.latest_delivered_at
    end,
    latest_delivery_latency_seconds = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_delivery_latency_seconds
      else maat_delivery_ledger.latest_delivery_latency_seconds
    end,
    latest_metadata = case
      when (excluded.last_event_at, excluded.last_event_id) >
        (maat_delivery_ledger.last_event_at, maat_delivery_ledger.last_event_id)
        then excluded.latest_metadata
      else maat_delivery_ledger.latest_metadata
    end,
    updated_at = clock_timestamp();

  -- The comparison reads raw and ledger in one statement snapshot. It uses
  -- every current raw row for the processed keys, including trigger-owned
  -- live events, and therefore validates the baseline/live handoff itself.
  with current_rows as materialized (
    select event.*
    from private.maat_delivery_ledger_backfill_batch base
    join public.maat_delivery_timing_events event using (delivery_key)
  ), current_aggregate as materialized (
    select
      event.delivery_key,
      min(event.delivery_kind) as delivery_kind,
      max(event.delivery_kind) as max_delivery_kind,
      min(event.target_table) as target_table,
      max(event.target_table) as max_target_table,
      min(event.target_id) as target_id,
      max(event.target_id) as max_target_id,
      min(event.user_id::text)::uuid as user_id,
      count(distinct coalesce(event.user_id::text, '<null>'))
        as user_id_values,
      min(event.cron_job_name) as cron_job_name,
      max(event.cron_job_name) as max_cron_job_name,
      min(event.scheduled_for) filter (
        where event.delivery_status in ('sent', 'skipped')
      ) as scheduled_for,
      min(event.created_at) as first_event_at,
      max(event.created_at) as last_event_at,
      min(coalesce(
        event.cron_picked_at,
        event.function_started_at,
        event.created_at
      )) filter (where event.delivery_status = 'picked') as first_picked_at,
      max(coalesce(
        event.cron_picked_at,
        event.function_started_at,
        event.created_at
      )) filter (where event.delivery_status = 'picked') as last_picked_at,
      min(event.delivered_at) filter (
        where event.delivery_status in ('sent', 'skipped')
      ) as first_delivered_at,
      min(event.delivered_at) filter (
        where event.delivery_status = 'sent'
      ) as first_sent_at,
      max(event.delivered_at) filter (
        where event.delivery_status = 'sent'
      ) as last_sent_at,
      count(*)::bigint as raw_event_count,
      count(*) filter (where event.delivery_status = 'picked')::bigint
        as picked_count,
      count(*) filter (where event.delivery_status = 'sent')::bigint
        as sent_count,
      count(*) filter (where event.delivery_status = 'skipped')::bigint
        as skipped_count,
      count(*) filter (where event.delivery_status = 'failed')::bigint
        as failed_count,
      count(*) filter (
        where event.delivery_status = 'duplicate_guarded'
      )::bigint as duplicate_guarded_count,
      count(event.delivery_latency_seconds) filter (
        where event.delivery_status = 'sent'
      )::bigint as sent_latency_count,
      coalesce(sum(event.delivery_latency_seconds::bigint) filter (
        where event.delivery_status = 'sent'
      ), 0)::bigint as sent_latency_sum_seconds,
      min(event.delivery_latency_seconds) filter (
        where event.delivery_status = 'sent'
      ) as min_sent_latency_seconds,
      max(event.delivery_latency_seconds) filter (
        where event.delivery_status = 'sent'
      ) as max_sent_latency_seconds,
      count(*) filter (
        where event.delivery_status = 'sent'
          and coalesce(
            event.delivery_latency_seconds > case
              when event.delivery_kind in (
                'reminder',
                'scheduled_notification'
              ) then 90
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
      )::bigint as late_sent_count
    from current_rows event
    group by event.delivery_key
  ), current_latest as materialized (
    select distinct on (event.delivery_key)
      event.*
    from current_rows event
    order by event.delivery_key, event.created_at desc, event.id desc
  )
  select count(*)
    into v_parity_mismatches
  from current_aggregate raw
  join current_latest latest using (delivery_key)
  left join public.maat_delivery_ledger ledger using (delivery_key)
  where ledger.delivery_key is null
     or raw.delivery_kind is distinct from raw.max_delivery_kind
     or raw.target_table is distinct from raw.max_target_table
     or raw.target_id is distinct from raw.max_target_id
     or raw.user_id_values > 1
     or raw.cron_job_name is distinct from raw.max_cron_job_name
     or raw.delivery_kind is distinct from ledger.delivery_kind
     or raw.target_table is distinct from ledger.target_table
     or raw.target_id is distinct from ledger.target_id
     or raw.user_id is distinct from ledger.user_id
     or raw.cron_job_name is distinct from ledger.cron_job_name
     or raw.scheduled_for is distinct from ledger.scheduled_for
     or raw.first_event_at is distinct from ledger.first_event_at
     or raw.last_event_at is distinct from ledger.last_event_at
     or latest.id is distinct from ledger.last_event_id
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
     or greatest(raw.sent_count - 1, 0)
       is distinct from ledger.duplicate_sent_count
     or raw.sent_latency_count is distinct from ledger.sent_latency_count
     or raw.sent_latency_sum_seconds
       is distinct from ledger.sent_latency_sum_seconds
     or raw.min_sent_latency_seconds
       is distinct from ledger.min_sent_latency_seconds
     or raw.max_sent_latency_seconds
       is distinct from ledger.max_sent_latency_seconds
     or raw.late_sent_count is distinct from ledger.late_sent_count
     or latest.delivery_status is distinct from ledger.latest_delivery_status
     or latest.delivery_attempt
       is distinct from ledger.latest_delivery_attempt
     or latest.skip_reason is distinct from ledger.latest_skip_reason
     or latest.error_code is distinct from ledger.latest_error_code
     or latest.scheduled_for is distinct from ledger.latest_scheduled_for
     or latest.cron_picked_at
       is distinct from ledger.latest_cron_picked_at
     or latest.function_started_at
       is distinct from ledger.latest_function_started_at
     or latest.delivered_at is distinct from ledger.latest_delivered_at
     or latest.delivery_latency_seconds
       is distinct from ledger.latest_delivery_latency_seconds
     or latest.metadata is distinct from ledger.latest_metadata;

  if v_parity_mismatches <> 0 then
    raise exception
      'maat delivery ledger batch parity failed for % delivery keys',
      v_parity_mismatches;
  end if;

  v_batch_completed_at := clock_timestamp();

  update private.maat_delivery_ledger_backfill_state
  set
    backfill_started_at = coalesce(backfill_started_at, v_batch_started_at),
    backfill_cursor_delivery_key = v_next_cursor,
    backfill_batches_completed = backfill_batches_completed + 1,
    baseline_raw_events_added = baseline_raw_events_added + v_batch_events,
    baseline_delivery_keys_added = baseline_delivery_keys_added + v_batch_keys,
    last_batch_started_at = v_batch_started_at,
    last_batch_completed_at = v_batch_completed_at,
    last_batch_delivery_keys = v_batch_keys,
    last_batch_raw_events = v_batch_events
  where singleton
  returning * into strict v_state;

  truncate table private.maat_delivery_ledger_backfill_batch;

  return jsonb_build_object(
    'already_completed', false,
    'batch_exhausted', false,
    'batch_delivery_keys', v_batch_keys,
    'batch_raw_events', v_batch_events,
    'batch_started_at', v_batch_started_at,
    'batch_completed_at', v_batch_completed_at,
    'backfill_cursor_delivery_key', v_state.backfill_cursor_delivery_key,
    'backfill_batches_completed', v_state.backfill_batches_completed,
    'baseline_raw_events_added', v_state.baseline_raw_events_added,
    'baseline_delivery_keys_added', v_state.baseline_delivery_keys_added,
    'finalization_required', true
  );
end;
$$;

revoke all on function private.backfill_maat_delivery_ledger(integer)
  from public, anon, authenticated;
grant execute on function private.backfill_maat_delivery_ledger(integer)
  to service_role;

comment on function private.backfill_maat_delivery_ledger(integer) is
'Processes one atomic, cursor-based Cut 14 historical batch of complete delivery keys (1..250; default 200), proves raw-versus-ledger parity for those keys, then advances state. It never finalizes automatically.';

create function private.finalize_maat_delivery_ledger_backfill()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_state private.maat_delivery_ledger_backfill_state%rowtype;
  v_completed_at timestamp with time zone;
  v_live_events bigint;
  v_ledger_events bigint;
begin
  select state.*
    into strict v_state
  from private.maat_delivery_ledger_backfill_state state
  where state.singleton
  for update;

  if v_state.backfill_completed_at is not null then
    return jsonb_build_object(
      'already_completed', true,
      'backfill_completed_at', v_state.backfill_completed_at,
      'backfill_cursor_delivery_key',
        v_state.backfill_cursor_delivery_key,
      'backfill_batches_completed', v_state.backfill_batches_completed,
      'baseline_raw_events_added', v_state.baseline_raw_events_added,
      'baseline_delivery_keys_added', v_state.baseline_delivery_keys_added
    );
  end if;

  if v_state.backfill_cursor_delivery_key is null and exists (
    select 1
    from public.maat_delivery_timing_events event
    where not exists (
      select 1
      from private.maat_delivery_ledger_live_event_ids live
      where live.event_id = event.id
    )
    limit 1
  ) then
    raise exception 'maat delivery ledger finalization found an unstarted baseline';
  end if;

  if exists (
    select 1
    from public.maat_delivery_timing_events event
    where event.delivery_key > v_state.backfill_cursor_delivery_key
      and not exists (
        select 1
        from private.maat_delivery_ledger_live_event_ids live
        where live.event_id = event.id
      )
    limit 1
  ) then
    raise exception
      'maat delivery ledger finalization found an unprocessed baseline key';
  end if;

  if exists (
    select 1
    from private.maat_delivery_ledger_live_event_ids live
    join public.maat_delivery_timing_events event on event.id = live.event_id
    left join public.maat_delivery_ledger ledger
      on ledger.delivery_key = event.delivery_key
    where ledger.delivery_key is null
    limit 1
  ) then
    raise exception
      'maat delivery ledger finalization found a live event without a ledger row';
  end if;

  select
    (select count(*)
     from private.maat_delivery_ledger_live_event_ids),
    coalesce((select sum(ledger.raw_event_count)
              from public.maat_delivery_ledger ledger), 0)
    into v_live_events, v_ledger_events;

  if v_ledger_events <>
    v_state.baseline_raw_events_added + v_live_events then
    raise exception
      'maat delivery ledger finalization event total mismatch: ledger %, baseline %, live %',
      v_ledger_events,
      v_state.baseline_raw_events_added,
      v_live_events;
  end if;

  if (
    select count(*) <> count(distinct ledger.delivery_key)
    from public.maat_delivery_ledger ledger
  ) then
    raise exception 'maat delivery ledger finalization found duplicate keys';
  end if;

  v_completed_at := clock_timestamp();

  update private.maat_delivery_ledger_backfill_state
  set backfill_completed_at = v_completed_at
  where singleton;

  truncate table private.maat_delivery_ledger_backfill_batch;
  truncate table private.maat_delivery_ledger_live_event_ids;

  return jsonb_build_object(
    'already_completed', false,
    'backfill_completed_at', v_completed_at,
    'backfill_cursor_delivery_key', v_state.backfill_cursor_delivery_key,
    'backfill_batches_completed', v_state.backfill_batches_completed,
    'baseline_raw_events_added', v_state.baseline_raw_events_added,
    'baseline_delivery_keys_added', v_state.baseline_delivery_keys_added,
    'live_events_merged', v_live_events,
    'ledger_raw_events', v_ledger_events,
    'ledger_rows', (select count(*) from public.maat_delivery_ledger)
  );
end;
$$;

revoke all on function private.finalize_maat_delivery_ledger_backfill()
  from public, anon, authenticated;
grant execute on function private.finalize_maat_delivery_ledger_backfill()
  to service_role;

comment on function private.finalize_maat_delivery_ledger_backfill() is
'Separately finalizes the resumable Cut 14 backfill only after no indexed baseline key remains, validates cumulative event accounting, records completion, and empties private staging/handoff rows.';

commit;
