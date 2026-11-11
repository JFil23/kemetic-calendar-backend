begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
-- No app entry, view or RLS policy calls these directly. Their existing checked
-- SECURITY DEFINER wrappers and triggers execute as the unchanged postgres owner.
-- In particular, the shared-experience helper's permission-bypass argument must
-- be restricted to trusted server callers.
do $migration$
declare signature text; target regprocedure;
begin
  foreach signature in array array[
    'public.ensure_shared_experience_for_flow_internal(bigint,uuid,uuid,boolean,bigint)',
    'public.user_event_has_active_reminder_flow(uuid,uuid)',
    'public.user_event_has_active_reminder_flow_for_occurrence(uuid,text)'
  ] loop
    target := to_regprocedure(signature);
    if target is null or not exists (select 1 from pg_proc
      where oid=target and prosecdef and pg_get_userbyid(proowner)='postgres') then
      raise exception 'Unrecognized internal function authority: %', signature;
    end if;
    execute format('revoke all privileges on function %s from public, anon, authenticated', target);
    execute format('grant execute on function %s to service_role', target);
  end loop;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
