-- These four existing SECURITY DEFINER helpers already schema-qualify every
-- application object. Pin their lookup context without replacing bodies, OIDs,
-- trigger bindings, ownership or privileges. Ordinary invoker SQL functions are
-- excluded: SET configuration would unnecessarily prevent their inlining.
do $migration$
declare
  signature text;
  target oid;
begin
  perform set_config('lock_timeout', '3s', true);
  foreach signature in array array[
    'public.current_user_id()',
    'public.fill_user_id()',
    'public.handle_new_user()',
    'private.room_broadcast_trigger()'
  ] loop
    target := to_regprocedure(signature);
    -- Fresh builds never had this formerly untracked managed-schema trigger.
    if target is null and signature = 'private.room_broadcast_trigger()' then
      continue;
    end if;
    if target is null or not exists (
      select 1 from pg_proc p
      where p.oid = target and p.prosecdef
        and pg_get_userbyid(p.proowner) = 'postgres'
        and p.prokind = 'f'
    ) then
      raise exception 'Unrecognized privileged helper authority: %', signature;
    end if;
    execute format('alter function %s set search_path = %L', target::regprocedure, '');
  end loop;
end;
$migration$;
