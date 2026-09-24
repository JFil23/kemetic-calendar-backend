#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <postgres-db-url>" >&2
  exit 2
fi

cut4_db_url="$1"
cut4_user_id="00000000-0000-4000-8000-00000000c402"
cut4_client_event_id="cut4-concurrent-skip-locked"
cut4_tmp_dir="$(mktemp -d)"
cut4_session_a_output="$cut4_tmp_dir/session-a.out"

cleanup() {
  psql "$cut4_db_url" -v ON_ERROR_STOP=1 -q <<SQL || true
delete from public.scheduled_notifications
where user_id = '$cut4_user_id'::uuid
  and client_event_id = '$cut4_client_event_id';
delete from auth.users where id = '$cut4_user_id'::uuid;
SQL
  rm -rf "$cut4_tmp_dir"
}
trap cleanup EXIT

psql "$cut4_db_url" -v ON_ERROR_STOP=1 -q <<SQL
delete from public.scheduled_notifications
where user_id = '$cut4_user_id'::uuid
  and client_event_id = '$cut4_client_event_id';
delete from auth.users where id = '$cut4_user_id'::uuid;
SQL

psql "$cut4_db_url" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '$cut4_user_id', 'authenticated', 'authenticated',
  'scheduled-notification-cut4-concurrency@example.test',
  'not-used', now(), now(), now()
);

insert into public.scheduled_notifications (
  user_id, client_event_id, scheduled_at, title, notification_type, is_active
) values (
  '$cut4_user_id', '$cut4_client_event_id',
  '1800-01-01 00:00:00+00', 'Concurrency fixture', 'event_start', true
);
SQL

psql "$cut4_db_url" -v ON_ERROR_STOP=1 -Atq >"$cut4_session_a_output" <<SQL &
begin;
select 'A_COUNT=' || count(*)
from public.claim_due_scheduled_notifications(
  '1801-01-01 00:00:00+00'::timestamp with time zone,
  500,
  900
)
where user_id = '$cut4_user_id'::uuid;
select pg_advisory_xact_lock(2147483000, 404);
select pg_sleep(3);
commit;
SQL
cut4_session_a_pid=$!

cut4_lock_seen=0
for _ in $(seq 1 50); do
  if [[ "$(psql "$cut4_db_url" -Atq -c \
    "select count(*) from pg_locks where locktype = 'advisory' and classid = 2147483000::oid and objid = 404::oid and granted")" == "1" ]]; then
    cut4_lock_seen=1
    break
  fi
  sleep 0.1
done

if [[ "$cut4_lock_seen" != "1" ]]; then
  echo "session A did not reach the locked post-claim checkpoint" >&2
  wait "$cut4_session_a_pid" || true
  exit 1
fi

cut4_session_b_count="$(psql "$cut4_db_url" -v ON_ERROR_STOP=1 -Atq <<SQL
select count(*)
from public.claim_due_scheduled_notifications(
  '1801-01-01 00:00:00+00'::timestamp with time zone,
  500,
  900
)
where user_id = '$cut4_user_id'::uuid;
SQL
)"

wait "$cut4_session_a_pid"

if ! grep -qx 'A_COUNT=1' "$cut4_session_a_output"; then
  echo "session A did not claim exactly one fixture row" >&2
  sed -n '1,80p' "$cut4_session_a_output" >&2
  exit 1
fi

if [[ "$cut4_session_b_count" != "0" ]]; then
  echo "session B did not SKIP LOCKED; claimed $cut4_session_b_count rows" >&2
  exit 1
fi

cut4_persisted_count="$(psql "$cut4_db_url" -v ON_ERROR_STOP=1 -Atq <<SQL
select count(*)
from public.scheduled_notifications
where user_id = '$cut4_user_id'::uuid
  and client_event_id = '$cut4_client_event_id'
  and claimed_at = '1801-01-01 00:00:00+00'::timestamp with time zone
  and claim_token is not null;
SQL
)"

if [[ "$cut4_persisted_count" != "1" ]]; then
  echo "the committed session A claim was not persisted exactly once" >&2
  exit 1
fi

echo "Cut 4 concurrency smoke passed: session A claimed 1, session B claimed 0."
