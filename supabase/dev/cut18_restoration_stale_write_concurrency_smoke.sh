#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <database-url>" >&2
  exit 2
fi

database_url="$1"
fixture_user_id="00000000-0000-4000-8000-000000001818"
fixture_email="cut18-concurrency@example.test"
tmp_dir="$(mktemp -d)"
newer_output="$tmp_dir/newer.out"
stale_output="$tmp_dir/stale.out"
baseline_count="$(psql "$database_url" -v ON_ERROR_STOP=1 -Atq -c "select count(*) from public.user_app_restoration_snapshots")"

cleanup() {
  psql "$database_url" -v ON_ERROR_STOP=1 -q <<SQL || true
delete from auth.users where id = '$fixture_user_id'::uuid;
SQL
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

psql "$database_url" -v ON_ERROR_STOP=1 -q <<SQL
delete from auth.users where id = '$fixture_user_id'::uuid;

insert into auth.users (
  id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '$fixture_user_id', 'authenticated', 'authenticated',
  '$fixture_email', 'not-used', now(), now(), now()
);

insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '$fixture_user_id', 'window', 'cut18-device', 'cut18-window',
    '{"state":"initial"}', 2, '/cut18/initial',
    '2026-01-18 01:00:00+00'
  ),
  (
    '$fixture_user_id', 'latest', '', '',
    '{"state":"initial"}', 2, '/cut18/initial',
    '2026-01-18 01:00:00+00'
  );
SQL

# The newer transaction locks both target rows before commit. The stale
# transaction then reaches the same conflicts, waits, and must compare against
# the newly committed row versions rather than its earlier arrival time.
psql "$database_url" -v ON_ERROR_STOP=1 -q >"$newer_output" <<SQL &
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"$fixture_user_id","role":"authenticated"}',
  true
);
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '$fixture_user_id', 'window', 'cut18-device', 'cut18-window',
    '{"state":"concurrent-newer"}', 2, '/cut18/concurrent-newer',
    '2026-01-18 03:00:00+00'
  ),
  (
    '$fixture_user_id', 'latest', '', '',
    '{"state":"concurrent-newer"}', 2, '/cut18/concurrent-newer',
    '2026-01-18 03:00:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;
select pg_advisory_xact_lock(218, 18);
select pg_sleep(3);
commit;
SQL
newer_pid=$!

lock_seen=0
for _ in $(seq 1 50); do
  lock_count="$(psql "$database_url" -Atq -c "select count(*) from pg_locks where locktype = 'advisory' and classid = 218::oid and objid = 18::oid and granted")"
  if [[ "$lock_count" == "1" ]]; then
    lock_seen=1
    break
  fi
  sleep 0.1
done

if [[ "$lock_seen" != "1" ]]; then
  echo "newer transaction did not reach its locked checkpoint" >&2
  wait "$newer_pid" || true
  exit 1
fi

psql "$database_url" -v ON_ERROR_STOP=1 -q >"$stale_output" <<SQL &
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"$fixture_user_id","role":"authenticated"}',
  true
);
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '$fixture_user_id', 'window', 'cut18-device', 'cut18-window',
    '{"state":"concurrent-stale"}', 2, '/cut18/concurrent-stale',
    '2026-01-18 02:00:00+00'
  ),
  (
    '$fixture_user_id', 'latest', '', '',
    '{"state":"concurrent-stale"}', 2, '/cut18/concurrent-stale',
    '2026-01-18 02:00:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;
commit;
SQL
stale_pid=$!

wait "$newer_pid"
wait "$stale_pid"

persisted_count="$(psql "$database_url" -v ON_ERROR_STOP=1 -Atq <<SQL
select count(*)
from public.user_app_restoration_snapshots
where user_id = '$fixture_user_id'::uuid
  and snapshot = '{"state":"concurrent-newer"}'::jsonb
  and route_location = '/cut18/concurrent-newer'
  and updated_at = '2026-01-18 03:00:00+00';
SQL
)"

if [[ "$persisted_count" != "2" ]]; then
  echo "stale interleaved transaction replaced a newer row" >&2
  exit 1
fi

psql "$database_url" -v ON_ERROR_STOP=1 -q <<SQL
delete from auth.users where id = '$fixture_user_id'::uuid;
SQL

final_count="$(psql "$database_url" -v ON_ERROR_STOP=1 -Atq -c "select count(*) from public.user_app_restoration_snapshots")"

if [[ "$final_count" != "$baseline_count" ]]; then
  echo "Cut 18 concurrency fixture cleanup changed the row baseline" >&2
  exit 1
fi

echo "Cut 18 concurrency smoke passed: committed newer rows survived stale interleaving."
