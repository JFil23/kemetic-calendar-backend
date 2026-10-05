-- Disposable local database only. All fixtures and assertions roll back.
begin;

create or replace function pg_temp.require(ok boolean, message text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%', message; end if;
end;
$$;

create or replace function pg_temp.as_user(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

insert into auth.users(id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000ca01', 'calendar-delete-owner@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000ca02', 'calendar-delete-member@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000ca03', 'calendar-delete-outsider@example.test', 'authenticated', 'authenticated');

insert into public.shared_calendars(id, owner_id, name) values
  ('10000000-0000-4000-8000-00000000ca01', '00000000-0000-4000-8000-00000000ca01', 'Calendar to delete'),
  ('10000000-0000-4000-8000-00000000ca02', '00000000-0000-4000-8000-00000000ca01', 'Calendar to retain');
insert into public.shared_calendar_members(calendar_id, user_id, role, status) values
  ('10000000-0000-4000-8000-00000000ca01', '00000000-0000-4000-8000-00000000ca01', 'owner', 'accepted'),
  ('10000000-0000-4000-8000-00000000ca01', '00000000-0000-4000-8000-00000000ca02', 'editor', 'accepted');
insert into public.user_events(user_id, calendar_id, client_event_id, title, starts_at, flow_local_id) values
  ('00000000-0000-4000-8000-00000000ca01', '10000000-0000-4000-8000-00000000ca01', 'calendar-delete-owner', 'Owner event', '2026-10-05T12:00:00Z', null),
  ('00000000-0000-4000-8000-00000000ca02', '10000000-0000-4000-8000-00000000ca01', 'calendar-delete-member', 'Member event', '2026-10-05T13:00:00Z', null),
  ('00000000-0000-4000-8000-00000000ca01', '10000000-0000-4000-8000-00000000ca01', 'calendar-delete-raw', 'Raw event deletion', '2026-10-05T14:00:00Z', null),
  ('00000000-0000-4000-8000-00000000ca01', '10000000-0000-4000-8000-00000000ca01', 'calendar-delete-semantic', 'Semantic event deletion', '2026-10-05T15:00:00Z', null),
  ('00000000-0000-4000-8000-00000000ca01', '10000000-0000-4000-8000-00000000ca02', 'calendar-delete-retain', 'Unaffected event', '2026-10-05T16:00:00Z', null);
create temp table original_events as
  select id, user_id, client_event_id, to_jsonb(e) as row_data
  from public.user_events e where client_event_id like 'calendar-delete-%';

-- A member leaves only their own membership. An outsider cannot delete it.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ca03');
select public.leave_shared_calendar('10000000-0000-4000-8000-00000000ca01');
reset role;
select pg_temp.require((select count(*) = 2 from public.shared_calendar_members
  where calendar_id = '10000000-0000-4000-8000-00000000ca01'),
  'An outsider changed calendar membership');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ca02');
select public.leave_shared_calendar('10000000-0000-4000-8000-00000000ca01');
reset role;
select pg_temp.require((select count(*) = 1 from public.shared_calendar_members
  where calendar_id = '10000000-0000-4000-8000-00000000ca01'),
  'Member leave must retain owner membership');
select pg_temp.require((select count(*) = 4 from public.user_events
  where calendar_id = '10000000-0000-4000-8000-00000000ca01'),
  'Member leave or outsider call deleted calendar events');

-- An ordinary event delete retains the live parent link and audit semantics.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ca01');
delete from public.user_events where client_event_id = 'calendar-delete-raw';
select pg_temp.require(public.delete_user_events_by_client_id_semantic(
  'calendar-delete-semantic', 'user_delete', true, 'calendar_delete_smoke', 'exact_occurrence') = 1,
  'Semantic event delete failed');
reset role;
select pg_temp.require((select calendar_id = '10000000-0000-4000-8000-00000000ca01'
  and delete_semantic = 'raw_delete' and not suppresses_client
  from public.event_deletion_trash where client_event_id = 'calendar-delete-raw'),
  'Ordinary event deletion lost live calendar link or raw audit semantics');
select pg_temp.require((select calendar_id = '10000000-0000-4000-8000-00000000ca01'
  and delete_semantic = 'user_delete' and suppresses_client
  and source_feature = 'calendar_delete_smoke' and delete_scope = 'exact_occurrence'
  and operation_id is not null and actor_id = '00000000-0000-4000-8000-00000000ca01'
  from public.event_deletion_trash where client_event_id = 'calendar-delete-semantic'),
  'Semantic deletion metadata changed');
-- Reset transaction-local RPC settings to model the next HTTP request.
select set_config(setting, '', true) from unnest(array[
  'app.event_delete_semantic', 'app.event_delete_suppresses_client',
  'app.event_delete_source_feature', 'app.event_delete_scope',
  'app.event_delete_operation_id'
]) as setting;

-- Missing auth and protected calendars keep their existing API behavior.
set local role authenticated;
select pg_temp.as_user(null);
do $$ begin
  begin
    perform public.leave_shared_calendar('10000000-0000-4000-8000-00000000ca01');
    raise exception 'Unauthenticated calendar deletion succeeded';
  exception when raise_exception then
    if sqlerrm <> 'AUTH_REQUIRED' then raise; end if;
  end;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ca01');
do $$ declare personal_id uuid; birthdays_id uuid; begin
  personal_id := public.ensure_personal_calendar_for_user(auth.uid());
  select id into birthdays_id from public.shared_calendars
    where owner_id = auth.uid() and system_type = 'birthdays';
  perform pg_temp.require(birthdays_id is not null, 'Missing protected birthday fixture');
  begin
    perform public.leave_shared_calendar(personal_id);
    raise exception 'Personal calendar deletion succeeded';
  exception when raise_exception then
    if sqlerrm <> 'CANNOT_DELETE_PERSONAL_CALENDAR' then raise; end if;
  end;
  begin
    perform public.leave_shared_calendar(birthdays_id);
    raise exception 'System calendar deletion succeeded';
  exception when raise_exception then
    if sqlerrm <> 'CANNOT_DELETE_SYSTEM_CALENDAR' then raise; end if;
  end;
end $$;

-- Regression: the owner RPC deletes the parent before the event BEFORE DELETE
-- trigger runs. Before the fix this raises event_deletion_trash_calendar_id_fkey.
select public.leave_shared_calendar('10000000-0000-4000-8000-00000000ca01');
reset role;
select pg_temp.require(not exists(select 1 from public.shared_calendars
  where id = '10000000-0000-4000-8000-00000000ca01'), 'Owner calendar still exists');
select pg_temp.require(not exists(select 1 from public.shared_calendar_members
  where calendar_id = '10000000-0000-4000-8000-00000000ca01'), 'Deleted calendar still has members');
select pg_temp.require(not exists(select 1 from public.user_events
  where calendar_id = '10000000-0000-4000-8000-00000000ca01'), 'Deleted calendar still has events');
select pg_temp.require((select count(*) = 4 and bool_and(t.calendar_id is null)
  and bool_and(t.user_id = o.user_id and t.row_data @> o.row_data)
  and bool_and(t.purge_after = t.deleted_at + interval '10 days')
  and bool_and(t.actor_id = '00000000-0000-4000-8000-00000000ca01')
  from public.event_deletion_trash t join original_events o on o.id = t.source_id
  where o.client_event_id <> 'calendar-delete-retain'),
  'Deletion archive must retain all original event data and owners with no dangling calendar link');
select pg_temp.require((select count(*) = 2 and bool_and(delete_semantic = 'raw_delete')
  and bool_and(not suppresses_client) and bool_and(operation_id is not null)
  from public.event_deletion_trash
  where client_event_id in ('calendar-delete-owner', 'calendar-delete-member')),
  'Calendar cascade changed raw-delete suppression semantics');
select pg_temp.require((select count(*) = 1 from public.user_events e
  join original_events o on o.id = e.id
  where o.client_event_id = 'calendar-delete-retain' and to_jsonb(e) = o.row_data),
  'Deleting one calendar changed another calendar event');
select pg_temp.require(not has_table_privilege('authenticated', 'public.event_deletion_trash', 'SELECT'),
  'Archive must remain inaccessible to direct user reads');
rollback;
