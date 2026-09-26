#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <postgres-db-url>" >&2
  exit 2
fi

db_url="$1"
fixture_user="00000000-0000-4000-8000-000000001919"
tmp_dir="$(mktemp -d)"
session_a="$tmp_dir/session-a.out"

cleanup() {
  psql "$db_url" -v ON_ERROR_STOP=1 -q <<SQL || true
delete from public.decan_reflection_schedule where user_id = '$fixture_user'::uuid;
delete from auth.users where id = '$fixture_user'::uuid;
select public.reconcile_decan_reflection_scheduler();
SQL
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

psql "$db_url" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (
  id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '$fixture_user', 'authenticated', 'authenticated',
  'reflection-one-shot-concurrency@example.test',
  'not-used', now(), now(), now()
);
insert into public.decan_reflection_schedule (
  user_id, decan_start, decan_end, send_at, next_attempt_at, status
) values (
  '$fixture_user', current_date - 9, current_date,
  now() - interval '1 minute', now() - interval '1 minute', 'pending'
);
SQL

psql "$db_url" -v ON_ERROR_STOP=1 -Atq >"$session_a" <<SQL &
begin;
select 'A_COUNT=' || count(*)
from public.claim_due_decan_reflection_schedule(now(), 25, 900)
where user_id = '$fixture_user'::uuid;
select pg_advisory_xact_lock(219, 19);
select pg_sleep(3);
commit;
SQL
pid_a=$!

lock_seen=0
for _ in $(seq 1 50); do
  if [[ "$(psql "$db_url" -Atq -c "select count(*) from pg_locks where locktype='advisory' and classid=219::oid and objid=19::oid and granted")" == "1" ]]; then
    lock_seen=1
    break
  fi
  sleep 0.1
done
if [[ "$lock_seen" != "1" ]]; then
  echo "session A did not reach the locked checkpoint" >&2
  wait "$pid_a" || true
  exit 1
fi

count_b="$(psql "$db_url" -v ON_ERROR_STOP=1 -Atq <<SQL
select count(*)
from public.claim_due_decan_reflection_schedule(now(), 25, 900)
where user_id = '$fixture_user'::uuid;
SQL
)"
wait "$pid_a"

grep -qx 'A_COUNT=1' "$session_a"
if [[ "$count_b" != "0" ]]; then
  echo "session B claimed $count_b rows instead of skipping the lease" >&2
  exit 1
fi

echo "Reflection one-shot claim concurrency smoke passed: A=1, B=0."
