-- Disposable fixtures; production data is never used by this test.
begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-4000-8000-00000000ca01','authenticated','authenticated','calendar-owner@example.test','unused',now(),now(),now()),
('00000000-0000-4000-8000-00000000ca02','authenticated','authenticated','calendar-other@example.test','unused',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ca01',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000ca01","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert_true(not has_table_privilege(current_user,'public.calendar_import_connections','select'),'credentials must be inaccessible');
select pg_temp.assert_true(not has_table_privilege(current_user,'public.calendar_import_oauth_states','select'),'OAuth states must be inaccessible');
select public.calendar_import_control('device:test','connect_device');
create temporary table test_lease as select public.calendar_import_control('device:test','begin') c;
select public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,
 '2026-10-01','2026-11-01','[{"key":"one","title":"Original","start":"2026-10-02T12:00:00Z","end":"2026-10-02T13:00:00Z"}]') from test_lease;
select pg_temp.assert_true((select count(*)=1 from public.user_events where title='Original'),'first import visible');
-- Clear the request-local reconciliation context, as a fresh API request does.
select set_config('app.calendar_import_connection','',true);
do $$ begin
 begin update public.user_events set title='Forbidden HAw edit' where title='Original';
 raise exception 'ordinary imported edit allowed'; exception when raise_exception then if sqlerrm<>'IMPORTED_CALENDAR_EVENT_READ_ONLY' then raise; end if; end;
end $$;
-- A HAw timestamp in the future must not overrule an external edit.
select set_config('app.calendar_import_connection',(select c->>'id' from test_lease),true);
update public.user_events set updated_at='2099-01-01' where title='Original';
update test_lease set c=public.calendar_import_control('device:test','begin');
select public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,
 '2026-10-01','2026-11-01','[{"key":"one","title":"External rename","start":"2026-10-03T12:00:00Z","end":"2026-10-03T13:00:00Z"},{"key":"all-day","title":"All day","start_date":"2026-10-04","end_date":"2026-10-05","all_day":true}]','America/Los_Angeles') from test_lease;
select pg_temp.assert_true((select count(*)=1 from public.user_events where title='External rename'),'external content wins');
select pg_temp.assert_true((select starts_at='2026-10-04T07:00:00Z' from public.user_events where title='All day'),'all-day local date survives timezone conversion');
insert into public.user_events(client_event_id,title,starts_at) values('calendar-test-authored','HAw authored','2026-10-03');
-- A malformed or duplicate provider snapshot is an atomic failure, never a prune.
update test_lease set c=public.calendar_import_control('device:test','begin');
do $$ declare c jsonb; begin select l.c into c from test_lease l;
 begin perform public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,
 '2026-10-01','2026-11-01','[{"key":"valid","title":"Must not leak","start":"2026-10-02"},{"key":"bad","title":"Missing date"}]');
 raise exception 'malformed snapshot accepted'; exception when raise_exception then if sqlerrm<>'INVALID_EVENT' then raise; end if; end;
 begin perform public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,
 '2026-10-01','2026-11-01','[{"key":"same","title":"One","start":"2026-10-02"},{"key":"same","title":"Two","start":"2026-10-03"}]');
 raise exception 'duplicate snapshot accepted'; exception when raise_exception then if sqlerrm<>'DUPLICATE_OCCURRENCE' then raise; end if; end;
end $$;
select pg_temp.assert_true((select count(*)=3 from public.user_events),'failed snapshot retains confirmed events');
update public.user_events set title='HAw authored' where client_event_id='calendar-test-authored';
select set_config('app.calendar_import_connection','',true);
do $$ begin
 begin delete from public.user_events where title='External rename';
 raise exception 'ordinary imported delete allowed'; exception when raise_exception then if sqlerrm<>'IMPORTED_CALENDAR_EVENT_READ_ONLY' then raise; end if; end;
end $$;
-- Pause invalidates an in-flight fetch but preserves imported content.
update test_lease set c=public.calendar_import_control('device:test','begin');
select public.calendar_import_control('device:test','pause');
do $$ declare c jsonb; begin select l.c into c from test_lease l;
 begin perform public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,'2026-10-01','2026-11-01','[]');
 raise exception 'stale response accepted'; exception when raise_exception then if sqlerrm<>'STALE_IMPORT' then raise; end if; end;
end $$;
select pg_temp.assert_true((select count(*)=3 from public.user_events),'pause retains events');
-- Another account cannot apply this connection's projection.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ca02',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000ca02","role":"authenticated"}',true);
do $$ declare c jsonb; begin select l.c into c from test_lease l;
 begin perform public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,'2026-10-01','2026-11-01','[]');
 raise exception 'cross-account accepted'; exception when raise_exception then if sqlerrm<>'STALE_IMPORT' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ca01',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000ca01","role":"authenticated"}',true);
update test_lease set c=public.calendar_import_control('device:test','begin');
select public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,'2026-10-01','2026-11-01','[]') from test_lease;
select pg_temp.assert_true((select count(*)=1 from public.user_events),'external deletion removes only imports');
select pg_temp.assert_true((select title='HAw authored' from public.user_events),'authored event survives');
-- An externally restored event is not suppressed by the preceding prune.
update test_lease set c=public.calendar_import_control('device:test','begin');
select public.calendar_import_apply((c->>'id')::uuid,(c->>'generation')::uuid,(c->>'refresh_id')::uuid,'2026-10-01','2026-11-01','[{"key":"one","title":"Restored","start":"2026-10-03T12:00:00Z"}]') from test_lease;
select pg_temp.assert_true((select count(*)=1 from public.user_events where title='Restored'),'provider restoration returns');
select public.calendar_import_control('device:test','disconnect');
select pg_temp.assert_true((select count(*)=1 from public.user_events),'disconnect preserves HAw event');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.event_deletion_trash where user_id='00000000-0000-4000-8000-00000000ca01' and suppresses_client),'import deletes never suppress');
set local role anon;
do $$ begin
 begin perform public.calendar_import_control('device:test','status'); raise exception 'anonymous allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
