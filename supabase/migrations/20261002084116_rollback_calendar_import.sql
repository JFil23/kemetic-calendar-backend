-- Requested rollback of the October 1 calendar-import release.
-- Original applied migration is retained so replay and hosted history agree.
-- Stop if any live import state remains; never discard user-authored events.
do $$ begin
  if exists(select 1 from public.user_events where client_event_id like 'native:v2:%')
     or exists(select 1 from public.calendar_import_connections where connected or enabled or credentials is not null)
     or exists(select 1 from public.calendar_import_oauth_states) then
    raise exception 'CALENDAR_ROLLBACK_REQUIRES_DISCONNECTED_EMPTY_PROJECTIONS';
  end if;
end $$;
drop trigger if exists calendar_import_read_only on public.user_events;
drop function if exists private.guard_calendar_import_projection();
drop function if exists public.calendar_import_apply(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,text);
drop function if exists public.calendar_import_control(text,text);
drop function if exists private.calendar_import_apply(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,text);
drop function if exists private.calendar_import_control(text,text);
drop table if exists public.calendar_import_oauth_states;
drop table if exists public.calendar_import_connections;
