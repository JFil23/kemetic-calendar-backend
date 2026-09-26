#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <database-url>" >&2
  exit 2
fi

database_url="$1"
fixture_prefix="cut14-concurrency"
locker_output="$(mktemp)"
backfill_output="$(mktemp)"

cleanup() {
  rm -f "$locker_output" "$backfill_output"
}
trap cleanup EXIT

psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
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
    raise exception 'clean replay did not abandon historical backfill';
  end if;
end
$$;

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

alter table public.maat_delivery_timing_events
  disable trigger maat_delivery_ledger_sync;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  cron_job_name,
  delivery_status,
  created_at
) values (
  'cut14-concurrency:handoff',
  'scheduled_notification',
  'scheduled_notifications',
  'cut14-concurrency-handoff-target',
  '2026-01-02 00:00:00+00',
  'cut14_concurrency_cron',
  'picked',
  '2026-01-02 00:00:00+00'
);

alter table public.maat_delivery_timing_events
  enable trigger maat_delivery_ledger_sync;
SQL

# Hold the backfill state row so the backfill call has started but cannot yet
# aggregate. A live raw insert commits during that interval and must be owned
# by the delta-id handoff exactly once.
psql "$database_url" -v ON_ERROR_STOP=1 >"$locker_output" <<'SQL' &
begin;
select singleton
from private.maat_delivery_ledger_backfill_state
where singleton
for update;
select pg_sleep(2);
commit;
SQL
locker_pid=$!

sleep 0.2

psql "$database_url" -v ON_ERROR_STOP=1 >"$backfill_output" <<'SQL' &
select private.backfill_maat_delivery_ledger(1);
SQL
backfill_pid=$!

sleep 0.2

psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  delivered_at,
  cron_job_name,
  delivery_status,
  created_at
) values (
  'cut14-concurrency:handoff',
  'scheduled_notification',
  'scheduled_notifications',
  'cut14-concurrency-handoff-target',
  '2026-01-02 00:00:00+00',
  '2026-01-02 00:00:30+00',
  'cut14_concurrency_cron',
  'sent',
  '2026-01-02 00:00:30+00'
);
SQL

wait "$locker_pid"
wait "$backfill_pid"

psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_ledger public.maat_delivery_ledger%rowtype;
begin
  select * into strict v_ledger
  from public.maat_delivery_ledger
  where delivery_key = 'cut14-concurrency:handoff';

  if v_ledger.raw_event_count <> 2
     or v_ledger.picked_count <> 1
     or v_ledger.sent_count <> 1
     or v_ledger.sent_latency_count <> 1
     or v_ledger.sent_latency_sum_seconds <> 30 then
    raise exception 'concurrent backfill handoff mismatch: %',
      row_to_json(v_ledger);
  end if;

  if (
    select count(*)
    from private.maat_delivery_ledger_live_event_ids
    where delivery_key = 'cut14-concurrency:handoff'
  ) <> 1 then
    raise exception 'live event id was not captured exactly once';
  end if;
end
$$;
SQL

# A live event for an already-processed key while the global backfill remains
# pending must still be counted once and remain in the handoff set.
psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  delivered_at,
  cron_job_name,
  delivery_status,
  created_at
) values (
  'cut14-concurrency:handoff',
  'scheduled_notification',
  'scheduled_notifications',
  'cut14-concurrency-handoff-target',
  '2026-01-02 00:00:00+00',
  '2026-01-02 00:00:45+00',
  'cut14_concurrency_cron',
  'sent',
  '2026-01-02 00:00:45+00'
);

do $$
begin
  if not exists (
    select 1
    from public.maat_delivery_ledger
    where delivery_key = 'cut14-concurrency:handoff'
      and raw_event_count = 3
      and picked_count = 1
      and sent_count = 2
      and sent_latency_count = 2
      and sent_latency_sum_seconds = 75
  ) then
    raise exception 'processed-key live event was lost or double-counted';
  end if;

  if (
    select count(*)
    from private.maat_delivery_ledger_live_event_ids
    where delivery_key = 'cut14-concurrency:handoff'
  ) <> 2 then
    raise exception 'pending handoff did not retain both live event ids';
  end if;
end
$$;

select private.backfill_maat_delivery_ledger(1);
select private.finalize_maat_delivery_ledger_backfill();

do $$
begin
  if not exists (
    select 1
    from private.maat_delivery_ledger_backfill_state
    where singleton
      and backfill_completed_at is not null
      and backfill_batches_completed = 1
      and baseline_delivery_keys_added = 1
      and baseline_raw_events_added = 1
  ) then
    raise exception 'concurrency fixture did not finalize correctly';
  end if;

  if exists (
    select 1 from private.maat_delivery_ledger_backfill_batch
    union all
    select 1 from private.maat_delivery_ledger_live_event_ids
  ) then
    raise exception 'finalization did not empty concurrency handoff state';
  end if;
end
$$;
SQL

# After finalization, concurrent inserts for one key serialize through the
# primary-key upsert, increment one row, and leave no handoff residue.
psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL' &
insert into public.maat_delivery_timing_events (
  delivery_key, delivery_kind, target_table, target_id,
  cron_job_name, delivery_status, created_at
) values (
  'cut14-concurrency:same-key', 'reminder', 'reminders',
  'cut14-concurrency-same-target', 'cut14_concurrency_cron', 'picked',
  '2026-01-02 01:00:00+00'
);
SQL
first_insert_pid=$!

psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL' &
insert into public.maat_delivery_timing_events (
  delivery_key, delivery_kind, target_table, target_id,
  cron_job_name, delivery_status, created_at
) values (
  'cut14-concurrency:same-key', 'reminder', 'reminders',
  'cut14-concurrency-same-target', 'cut14_concurrency_cron', 'failed',
  '2026-01-02 01:00:01+00'
);
SQL
second_insert_pid=$!

wait "$first_insert_pid"
wait "$second_insert_pid"

psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if (
    select count(*)
    from public.maat_delivery_ledger
    where delivery_key = 'cut14-concurrency:same-key'
  ) <> 1 then
    raise exception 'concurrent same-key inserts created multiple ledger rows';
  end if;

  if not exists (
    select 1
    from public.maat_delivery_ledger
    where delivery_key = 'cut14-concurrency:same-key'
      and raw_event_count = 2
      and picked_count = 1
      and failed_count = 1
  ) then
    raise exception 'concurrent same-key inserts were lost or double-counted';
  end if;

  if exists (
    select 1
    from private.maat_delivery_ledger_live_event_ids
    where delivery_key = 'cut14-concurrency:same-key'
  ) then
    raise exception 'post-finalization concurrent inserts left handoff rows';
  end if;
end
$$;

delete from public.maat_delivery_timing_events
where delivery_key like 'cut14-concurrency:%';

delete from private.maat_delivery_ledger_live_event_ids
where delivery_key like 'cut14-concurrency:%';

delete from public.maat_delivery_ledger
where delivery_key like 'cut14-concurrency:%';
SQL

echo "Cut 14 delivery-ledger concurrency smoke passed."
