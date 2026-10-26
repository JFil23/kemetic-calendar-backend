#!/usr/bin/env python3
"""Disposable loopback DB only: preserve a legacy trigger's actual function OID."""
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse


if len(sys.argv) != 2:
    raise SystemExit('usage: room_broadcast_schema_move_smoke.py <local-database-url>')
database_url = sys.argv[1]
parsed_url = urlparse(database_url)
if parsed_url.scheme not in ('postgres', 'postgresql') or parsed_url.hostname not in (
    'localhost', '127.0.0.1', '::1'
):
    raise SystemExit('This fixture smoke requires a disposable loopback database.')

migration = (
    Path(__file__).resolve().parents[1]
    / 'migrations'
    / '20261026181447_move_room_broadcast_trigger_to_private.sql'
).read_text(encoding='utf-8')

# Execute the unchanged migration text, including its anonymous block, inside
# this test transaction. No second implementation of the migration is tested.
sql = r'''
begin;
set local statement_timeout = '15s';
create schema if not exists realtime;
create schema if not exists private;

do $$
begin
  if to_regprocedure('realtime.room_broadcast_trigger()') is not null
     or to_regprocedure('private.room_broadcast_trigger()') is not null then
    raise exception 'Refusing to replace an existing room broadcast function';
  end if;
end;
$$;

create function pg_temp.apply_room_broadcast_move()
returns void language plpgsql as $apply$
begin
  execute $migration_source$''' + migration + r'''$migration_source$;
end;
$apply$;

create function pg_temp.assert_true(ok boolean, message text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%', message; end if;
end;
$$;

-- Fresh rebuild: neither legacy nor target function exists.
select pg_temp.apply_room_broadcast_move();
select pg_temp.assert_true(
  to_regprocedure('realtime.room_broadcast_trigger()') is null
  and to_regprocedure('private.room_broadcast_trigger()') is null,
  'Fresh rebuild unexpectedly created a room broadcast function'
);

create function realtime.room_broadcast_trigger()
returns trigger language plpgsql security definer as $$
begin
  new.payload := new.payload || ':triggered';
  return new;
end;
$$;
create temporary table room_broadcast_probe(payload text);
create trigger room_broadcast_probe_trigger
before insert on room_broadcast_probe
for each row execute function realtime.room_broadcast_trigger();

create temporary table function_before as
select p.oid, to_jsonb(p) - 'pronamespace' as attributes
from pg_proc p
where p.oid = 'realtime.room_broadcast_trigger()'::regprocedure;
create temporary table trigger_before as
select t.oid, to_jsonb(t) as attributes
from pg_trigger t
where t.tgfoid = 'realtime.room_broadcast_trigger()'::regprocedure;

select pg_temp.apply_room_broadcast_move();
select pg_temp.assert_true(
  to_regprocedure('realtime.room_broadcast_trigger()') is null
  and to_regprocedure('private.room_broadcast_trigger()') = (select oid from function_before),
  'Legacy function was not moved with its original OID'
);
select pg_temp.assert_true(
  (select to_jsonb(p) - 'pronamespace' = b.attributes
   from pg_proc p join function_before b on p.oid = b.oid),
  'Move changed function body, owner, ACL, settings or other attributes'
);
select pg_temp.assert_true(
  (select to_jsonb(t) = b.attributes
   from pg_trigger t join trigger_before b on t.oid = b.oid),
  'Move changed the bound trigger or its function OID'
);
insert into room_broadcast_probe values ('after-move');
select pg_temp.assert_true(
  (select payload = 'after-move:triggered' from room_broadcast_probe),
  'Existing bound trigger no longer fires after the schema move'
);

-- Already moved: a repeated migration must preserve the same object exactly.
select pg_temp.apply_room_broadcast_move();
select pg_temp.assert_true(
  (select to_jsonb(p) - 'pronamespace' = b.attributes
   from pg_proc p join function_before b on p.oid = b.oid),
  'Already-moved migration was not idempotent'
);

-- Explicit ACL and function-local settings must also survive intact.
alter function private.room_broadcast_trigger() set schema realtime;
revoke execute on function realtime.room_broadcast_trigger() from public;
alter function realtime.room_broadcast_trigger() set search_path = pg_catalog, pg_temp;
update function_before b
set attributes = to_jsonb(p) - 'pronamespace'
from pg_proc p where p.oid = b.oid;
select pg_temp.apply_room_broadcast_move();
select pg_temp.assert_true(
  (select p.proacl is not null and p.proconfig is not null
          and to_jsonb(p) - 'pronamespace' = b.attributes
   from pg_proc p join function_before b on p.oid = b.oid),
  'Move changed an explicit ACL or function-local search path'
);
insert into room_broadcast_probe values ('explicit-settings');
select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(payload like '%:triggered') from room_broadcast_probe),
  'Bound trigger stopped firing with explicit settings after the move'
);

-- A target collision must fail closed and preserve both existing functions.
create function realtime.room_broadcast_trigger()
returns trigger language plpgsql as $$ begin return new; end; $$;
create temporary table conflicting_function_before as
select p.oid, to_jsonb(p) as attributes
from pg_proc p
where p.oid = 'realtime.room_broadcast_trigger()'::regprocedure;
do $$
begin
  begin
    perform pg_temp.apply_room_broadcast_move();
    raise exception 'Expected source/target collision rejection';
  exception when duplicate_function then null;
  end;
end;
$$;
select pg_temp.assert_true(
  (select to_jsonb(p) = b.attributes
   from pg_proc p join conflicting_function_before b on p.oid = b.oid)
  and (select to_jsonb(p) - 'pronamespace' = b.attributes
       from pg_proc p join function_before b on p.oid = b.oid),
  'Collision rejection modified an existing function'
);
drop function realtime.room_broadcast_trigger();

-- Extension members must never be moved, including an already-moved target.
alter extension plpgsql add function private.room_broadcast_trigger();
do $$
begin
  begin
    perform pg_temp.apply_room_broadcast_move();
    raise exception 'Expected extension-owned target rejection';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;
alter extension plpgsql drop function private.room_broadcast_trigger();
alter function private.room_broadcast_trigger() set schema realtime;
alter extension plpgsql add function realtime.room_broadcast_trigger();
do $$
begin
  begin
    perform pg_temp.apply_room_broadcast_move();
    raise exception 'Expected extension-owned source rejection';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;
select pg_temp.assert_true(
  to_regprocedure('realtime.room_broadcast_trigger()') = (select oid from function_before)
  and to_regprocedure('private.room_broadcast_trigger()') is null,
  'Extension-owned rejection changed function identity or schema'
);
select pg_temp.assert_true(
  (select to_jsonb(t) = b.attributes
   from pg_trigger t join trigger_before b on t.oid = b.oid),
  'Guarded cases changed the original trigger binding'
);
rollback;
'''
result = subprocess.run(
    ['psql', database_url, '-X', '-v', 'ON_ERROR_STOP=1', '-q'],
    input=sql, text=True, capture_output=True,
)
if result.returncode:
    sys.stderr.write(result.stdout + result.stderr)
    raise SystemExit(result.returncode)
print('Room broadcast schema move passed: fresh, bound-trigger OID/behavior, '
      'exact attributes/ACL/settings, idempotence, collision and extension guards.')
