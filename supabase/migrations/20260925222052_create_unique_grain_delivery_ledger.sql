begin;

-- Cut 14 keeps the append-only timing history authoritative while adding one
-- compact, synchronously maintained row per logical delivery_key. Creating
-- the trigger in this short transaction drains any in-flight raw inserts;
-- every insert after commit is captured in the private handoff table until
-- the historical backfill completes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.maat_delivery_ledger (
  delivery_key text primary key,
  delivery_kind text not null,
  target_table text not null,
  target_id text not null,
  user_id uuid,
  cron_job_name text not null,

  -- Matches the current receipt-health reader: earliest schedule among sent
  -- or skipped events for the delivery key.
  scheduled_for timestamp with time zone,
  first_event_at timestamp with time zone not null,
  last_event_at timestamp with time zone not null,
  last_event_id uuid not null,
  first_picked_at timestamp with time zone,
  last_picked_at timestamp with time zone,
  first_delivered_at timestamp with time zone,
  first_sent_at timestamp with time zone,
  last_sent_at timestamp with time zone,

  raw_event_count bigint not null default 0,
  picked_count bigint not null default 0,
  sent_count bigint not null default 0,
  skipped_count bigint not null default 0,
  failed_count bigint not null default 0,
  duplicate_guarded_count bigint not null default 0,
  duplicate_sent_count bigint generated always as (
    greatest(sent_count - 1, 0)
  ) stored,

  sent_latency_count bigint not null default 0,
  sent_latency_sum_seconds bigint not null default 0,
  min_sent_latency_seconds integer,
  max_sent_latency_seconds integer,
  late_sent_count bigint not null default 0,

  latest_delivery_status text not null,
  latest_delivery_attempt integer not null,
  latest_skip_reason text,
  latest_error_code text,
  latest_scheduled_for timestamp with time zone,
  latest_cron_picked_at timestamp with time zone,
  latest_function_started_at timestamp with time zone,
  latest_delivered_at timestamp with time zone,
  latest_delivery_latency_seconds integer,
  latest_metadata jsonb not null default '{}'::jsonb,

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint maat_delivery_ledger_latest_status_check check (
    latest_delivery_status = any (
      array[
        'picked'::text,
        'sent'::text,
        'skipped'::text,
        'failed'::text,
        'duplicate_guarded'::text
      ]
    )
  ),
  constraint maat_delivery_ledger_nonnegative_counts_check check (
    raw_event_count >= 0
    and picked_count >= 0
    and sent_count >= 0
    and skipped_count >= 0
    and failed_count >= 0
    and duplicate_guarded_count >= 0
    and sent_latency_count >= 0
    and sent_latency_sum_seconds >= 0
    and late_sent_count >= 0
  ),
  constraint maat_delivery_ledger_status_total_check check (
    raw_event_count = picked_count + sent_count + skipped_count
      + failed_count + duplicate_guarded_count
  ),
  constraint maat_delivery_ledger_latency_count_check check (
    sent_latency_count <= sent_count
    and late_sent_count <= sent_latency_count
  )
);

comment on table public.maat_delivery_ledger is
'Cut 14 canonical delivery ledger: exactly one compact aggregate row per delivery_key. Raw timing history remains authoritative and unchanged.';

comment on column public.maat_delivery_ledger.scheduled_for is
'Earliest scheduled_for among raw sent/skipped events, matching the current maat_delivery_receipt_health semantics.';

alter table public.maat_delivery_ledger enable row level security;
revoke all privileges on table public.maat_delivery_ledger
  from public, anon, authenticated;
grant all privileges on table public.maat_delivery_ledger to service_role;

create table private.maat_delivery_ledger_backfill_state (
  singleton boolean primary key default true check (singleton),
  installed_at timestamp with time zone not null default clock_timestamp(),
  backfill_started_at timestamp with time zone,
  backfill_completed_at timestamp with time zone,
  baseline_raw_events_added bigint not null default 0,
  baseline_delivery_keys_added bigint not null default 0
);

insert into private.maat_delivery_ledger_backfill_state (singleton)
values (true);

create table private.maat_delivery_ledger_live_event_ids (
  event_id uuid primary key,
  delivery_key text not null,
  captured_at timestamp with time zone not null default clock_timestamp()
);

create index maat_delivery_ledger_live_event_ids_key_idx
  on private.maat_delivery_ledger_live_event_ids (delivery_key);

-- A permanent schema object keeps the database analyzer aware of the batch
-- shape. It is unlogged, private, serialized by the backfill state row, and
-- truncated before the one-time backfill commits.
create unlogged table private.maat_delivery_ledger_backfill_batch (
  delivery_key text primary key,
  delivery_kind text not null,
  max_delivery_kind text not null,
  target_table text not null,
  max_target_table text not null,
  target_id text not null,
  max_target_id text not null,
  user_id uuid,
  user_id_values bigint not null,
  cron_job_name text not null,
  max_cron_job_name text not null,
  scheduled_for timestamp with time zone,
  first_event_at timestamp with time zone not null,
  last_event_at timestamp with time zone not null,
  first_picked_at timestamp with time zone,
  last_picked_at timestamp with time zone,
  first_delivered_at timestamp with time zone,
  first_sent_at timestamp with time zone,
  last_sent_at timestamp with time zone,
  raw_event_count bigint not null,
  picked_count bigint not null,
  sent_count bigint not null,
  skipped_count bigint not null,
  failed_count bigint not null,
  duplicate_guarded_count bigint not null,
  sent_latency_count bigint not null,
  sent_latency_sum_seconds bigint not null,
  min_sent_latency_seconds integer,
  max_sent_latency_seconds integer,
  late_sent_count bigint not null
);

revoke all privileges on table private.maat_delivery_ledger_backfill_state
  from public, anon, authenticated;
revoke all privileges on table private.maat_delivery_ledger_live_event_ids
  from public, anon, authenticated;
revoke all privileges on table private.maat_delivery_ledger_backfill_batch
  from public, anon, authenticated;
grant select on table private.maat_delivery_ledger_backfill_state
  to service_role;
grant select on table private.maat_delivery_ledger_live_event_ids
  to service_role;
grant select on table private.maat_delivery_ledger_backfill_batch
  to service_role;

create or replace function private.sync_maat_delivery_ledger_from_raw()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_backfill_completed_at timestamp with time zone;
  v_applied boolean := false;
  v_picked_at timestamp with time zone;
  v_is_late boolean;
begin
  select state.backfill_completed_at
    into v_backfill_completed_at
  from private.maat_delivery_ledger_backfill_state state
  where state.singleton;

  if not found then
    raise exception 'maat delivery ledger backfill state is missing';
  end if;

  -- Until the baseline is committed, this exact event id separates live
  -- trigger-owned increments from rows owned by the historical aggregate.
  if v_backfill_completed_at is null then
    insert into private.maat_delivery_ledger_live_event_ids (
      event_id,
      delivery_key
    ) values (
      new.id,
      new.delivery_key
    );
  end if;

  v_picked_at := case
    when new.delivery_status = 'picked' then
      coalesce(new.cron_picked_at, new.function_started_at, new.created_at)
    else null
  end;

  v_is_late := new.delivery_status = 'sent'
    and new.delivery_latency_seconds is not null
    and new.delivery_latency_seconds > case
      when new.delivery_kind in ('reminder', 'scheduled_notification') then 90
      when new.delivery_kind = 'decan_reflection' then 420
      when new.delivery_kind in (
        'decan_opening',
        'drift_nudge',
        'strength_nudge'
      ) then 3600
      else 300
    end;

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
  ) values (
    new.delivery_key,
    new.delivery_kind,
    new.target_table,
    new.target_id,
    new.user_id,
    new.cron_job_name,
    case
      when new.delivery_status in ('sent', 'skipped') then new.scheduled_for
      else null
    end,
    new.created_at,
    new.created_at,
    new.id,
    v_picked_at,
    v_picked_at,
    case
      when new.delivery_status in ('sent', 'skipped') then new.delivered_at
      else null
    end,
    case when new.delivery_status = 'sent' then new.delivered_at else null end,
    case when new.delivery_status = 'sent' then new.delivered_at else null end,
    1,
    (new.delivery_status = 'picked')::integer,
    (new.delivery_status = 'sent')::integer,
    (new.delivery_status = 'skipped')::integer,
    (new.delivery_status = 'failed')::integer,
    (new.delivery_status = 'duplicate_guarded')::integer,
    (
      new.delivery_status = 'sent'
      and new.delivery_latency_seconds is not null
    )::integer,
    case
      when new.delivery_status = 'sent' then
        coalesce(new.delivery_latency_seconds, 0)::bigint
      else 0
    end,
    case
      when new.delivery_status = 'sent' then new.delivery_latency_seconds
      else null
    end,
    case
      when new.delivery_status = 'sent' then new.delivery_latency_seconds
      else null
    end,
    v_is_late::integer,
    new.delivery_status,
    new.delivery_attempt,
    new.skip_reason,
    new.error_code,
    new.scheduled_for,
    new.cron_picked_at,
    new.function_started_at,
    new.delivered_at,
    new.delivery_latency_seconds,
    new.metadata
  )
  on conflict (delivery_key) do update
  set
    scheduled_for = case
      when maat_delivery_ledger.scheduled_for is null then excluded.scheduled_for
      when excluded.scheduled_for is null then maat_delivery_ledger.scheduled_for
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
      when maat_delivery_ledger.first_sent_at is null then excluded.first_sent_at
      when excluded.first_sent_at is null then maat_delivery_ledger.first_sent_at
      else least(maat_delivery_ledger.first_sent_at, excluded.first_sent_at)
    end,
    last_sent_at = case
      when maat_delivery_ledger.last_sent_at is null then excluded.last_sent_at
      when excluded.last_sent_at is null then maat_delivery_ledger.last_sent_at
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
    updated_at = clock_timestamp()
  where maat_delivery_ledger.delivery_kind = excluded.delivery_kind
    and maat_delivery_ledger.target_table = excluded.target_table
    and maat_delivery_ledger.target_id = excluded.target_id
    and maat_delivery_ledger.user_id is not distinct from excluded.user_id
    and maat_delivery_ledger.cron_job_name = excluded.cron_job_name
  returning true into v_applied;

  if not coalesce(v_applied, false) then
    raise exception
      'maat delivery ledger identity drift for delivery_key %',
      new.delivery_key;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_maat_delivery_ledger_from_raw()
  from public, anon, authenticated;

create trigger maat_delivery_ledger_sync
after insert on public.maat_delivery_timing_events
for each row
execute function private.sync_maat_delivery_ledger_from_raw();

create or replace function private.backfill_maat_delivery_ledger()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_completed_at timestamp with time zone;
  v_baseline_events bigint;
  v_baseline_keys bigint;
begin
  select state.backfill_completed_at
    into v_completed_at
  from private.maat_delivery_ledger_backfill_state state
  where state.singleton
  for update;

  if not found then
    raise exception 'maat delivery ledger backfill state is missing';
  end if;

  if v_completed_at is not null then
    return jsonb_build_object(
      'already_completed', true,
      'backfill_completed_at', v_completed_at,
      'ledger_rows', (select count(*) from public.maat_delivery_ledger),
      'raw_rows', (select count(*) from public.maat_delivery_timing_events)
    );
  end if;

  update private.maat_delivery_ledger_backfill_state
  set backfill_started_at = clock_timestamp()
  where singleton;

  truncate table private.maat_delivery_ledger_backfill_batch;

  insert into private.maat_delivery_ledger_backfill_batch
  select
    e.delivery_key,
    min(e.delivery_kind) as delivery_kind,
    max(e.delivery_kind) as max_delivery_kind,
    min(e.target_table) as target_table,
    max(e.target_table) as max_target_table,
    min(e.target_id) as target_id,
    max(e.target_id) as max_target_id,
    min(e.user_id::text)::uuid as user_id,
    count(distinct coalesce(e.user_id::text, '<null>')) as user_id_values,
    min(e.cron_job_name) as cron_job_name,
    max(e.cron_job_name) as max_cron_job_name,
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
  where not exists (
    select 1
    from private.maat_delivery_ledger_live_event_ids live
    where live.event_id = e.id
  )
  group by e.delivery_key;

  if exists (
    select 1
    from private.maat_delivery_ledger_backfill_batch base
    where base.delivery_kind is distinct from base.max_delivery_kind
       or base.target_table is distinct from base.max_target_table
       or base.target_id is distinct from base.max_target_id
       or base.user_id_values > 1
       or base.cron_job_name is distinct from base.max_cron_job_name
  ) then
    raise exception 'maat delivery ledger backfill found identity drift';
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
      'maat delivery ledger backfill conflicts with a live ledger identity';
  end if;

  select coalesce(sum(base.raw_event_count), 0), count(*)
    into v_baseline_events, v_baseline_keys
  from private.maat_delivery_ledger_backfill_batch base;

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
  cross join lateral (
    select e.*
    from public.maat_delivery_timing_events e
    where e.delivery_key = base.delivery_key
      and not exists (
        select 1
        from private.maat_delivery_ledger_live_event_ids live
        where live.event_id = e.id
      )
    order by e.created_at desc, e.id desc
    limit 1
  ) latest
  on conflict (delivery_key) do update
  set
    scheduled_for = case
      when maat_delivery_ledger.scheduled_for is null then excluded.scheduled_for
      when excluded.scheduled_for is null then maat_delivery_ledger.scheduled_for
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
      when maat_delivery_ledger.first_sent_at is null then excluded.first_sent_at
      when excluded.first_sent_at is null then maat_delivery_ledger.first_sent_at
      else least(maat_delivery_ledger.first_sent_at, excluded.first_sent_at)
    end,
    last_sent_at = case
      when maat_delivery_ledger.last_sent_at is null then excluded.last_sent_at
      when excluded.last_sent_at is null then maat_delivery_ledger.last_sent_at
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

  update private.maat_delivery_ledger_backfill_state
  set
    backfill_completed_at = clock_timestamp(),
    baseline_raw_events_added = v_baseline_events,
    baseline_delivery_keys_added = v_baseline_keys
  where singleton
  returning backfill_completed_at into v_completed_at;

  truncate table private.maat_delivery_ledger_backfill_batch;

  return jsonb_build_object(
    'already_completed', false,
    'backfill_completed_at', v_completed_at,
    'baseline_raw_events_added', v_baseline_events,
    'baseline_delivery_keys_added', v_baseline_keys,
    'live_events_excluded', (
      select count(*) from private.maat_delivery_ledger_live_event_ids
    ),
    'ledger_rows', (select count(*) from public.maat_delivery_ledger),
    'raw_rows', (select count(*) from public.maat_delivery_timing_events)
  );
end;
$$;

revoke all on function private.backfill_maat_delivery_ledger()
  from public, anon, authenticated;
grant execute on function private.backfill_maat_delivery_ledger()
  to service_role;

comment on function private.backfill_maat_delivery_ledger() is
'Idempotent Cut 14 historical backfill. Adds only raw events not already captured by the live-trigger handoff, then marks the one-time baseline complete.';

-- Cut 14 intentionally leaves the four delivery-health readers on the raw
-- table. Cut 15 owns reader migration; Cut 16 owns raw-history retention.

commit;
