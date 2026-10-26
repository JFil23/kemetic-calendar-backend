-- Custom functions must live outside Supabase-managed schemas before a
-- platform upgrade. Move the legacy function without replacing its object,
-- body, trigger bindings, ownership, privileges or execution settings.
-- Fresh databases never had this untracked legacy function.
do $migration$
declare
  legacy_function oid := to_regprocedure('realtime.room_broadcast_trigger()');
  private_function oid := to_regprocedure('private.room_broadcast_trigger()');
  existing_function oid;
begin
  perform set_config('lock_timeout', '3s', true);

  if legacy_function is not null and private_function is not null then
    raise duplicate_function using
      message = 'Both legacy and private room broadcast functions exist';
  end if;

  existing_function := coalesce(legacy_function, private_function);
  if existing_function is null then
    return;
  end if;

  if exists (
    select 1
    from pg_depend dependency
    where dependency.classid = 'pg_proc'::regclass
      and dependency.objid = existing_function
      and dependency.deptype = 'e'
  ) then
    raise object_not_in_prerequisite_state using
      message = 'Room broadcast function belongs to an extension';
  end if;

  if not exists (
    select 1
    from pg_proc function
    where function.oid = existing_function
      and function.prokind = 'f'
      and function.prorettype = 'pg_catalog.trigger'::regtype
  ) then
    raise object_not_in_prerequisite_state using
      message = 'Room broadcast function is not the expected trigger function';
  end if;

  if legacy_function is not null then
    alter function realtime.room_broadcast_trigger() set schema private;
  end if;
end;
$migration$;
