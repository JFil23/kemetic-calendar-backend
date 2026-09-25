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
  if (
    select backfill_completed_at is not null
    from private.maat_delivery_ledger_backfill_state
    where singleton
  ) then
    raise exception 'concurrency smoke requires a pending clean-replay backfill';
  end if;
end
$$;

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
select private.backfill_maat_delivery_ledger();
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

# Concurrent inserts for one key serialize through the primary-key upsert and
# must both increment the single ledger row.
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
