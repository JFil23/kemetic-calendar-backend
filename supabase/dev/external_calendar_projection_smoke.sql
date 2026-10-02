-- Disposable local database only. Roll back every fixture and assertion.
begin;
create or replace function pg_temp.require(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',msg; end if;end$$;
create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
end$$;
insert into auth.users(id,email,aud,role) values
 ('90000000-0000-4000-8000-000000000001','calendar-fixture-one@example.test','authenticated','authenticated'),
 ('90000000-0000-4000-8000-000000000002','calendar-fixture-two@example.test','authenticated','authenticated');
select pg_temp.as_user('90000000-0000-4000-8000-000000000001');
insert into public.user_events(user_id,client_event_id,title,starts_at,calendar_id) values
 ('90000000-0000-4000-8000-000000000001','authored-preservation-fixture','Authored stays unchanged','2026-10-02T12:00:00Z',public.ensure_personal_calendar_for_user('90000000-0000-4000-8000-000000000001'));
create temp table authored_receipt as select count(*) n, md5(coalesce(string_agg(row_to_json(e)::text,'' order by id),'')) checksum from public.user_events e;

do $$declare
 uid uuid:='90000000-0000-4000-8000-000000000001';
 con jsonb; cl jsonb; result jsonb; source_id uuid; prod_id uuid; native_id uuid; revision bigint;
 event jsonb:='{"provider_event_id":"recurrence-instance","recurrence_id":"series:2026-10-02T09:00:00Z","title":"Outside event","all_day":false,"starts_at":"2026-10-02T10:00:00Z","ends_at":"2026-10-02T11:00:00Z"}';
 payload jsonb;
begin
 con:=public.external_calendar_service_v1('connect',uid,'staging','{"provider_subject":"google-sub-one","account_label":"Fixture","credentials":{"sealed":true}}');
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{}');
 perform public.external_calendar_service_v1('sources',uid,'staging',cl||'{"sources":[{"provider_calendar_id":"outside@example.test","label":"Work"}]}');
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 source_id:=(result->'sources'->0->>'id')::uuid;revision:=(result->'connection'->>'revision')::bigint;
 perform pg_temp.require(result->'sources'->0->>'selected'='false','Consent does not select calendars');
 perform public.external_calendar_service_v1('select_sources',uid,'staging',jsonb_build_object('expected_revision',revision,'source_ids',jsonb_build_array(source_id)));
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{}');
 payload:=cl||jsonb_build_object('start','2026-10-01T00:00:00Z','end','2026-11-01T00:00:00Z','sources',jsonb_build_array(jsonb_build_object('id',source_id,'events',jsonb_build_array(event))));
 perform public.external_calendar_service_v1('apply',uid,'staging',payload);
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where user_id=uid),'First snapshot');
 begin perform public.external_calendar_service_v1('apply',uid,'staging',payload);raise exception 'Replay accepted';exception when invalid_parameter_value then null;end;
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{}');
 perform public.external_calendar_service_v1('apply',uid,'staging',payload||cl||jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('id',source_id,'events',jsonb_build_array(event||'{"starts_at":"2026-10-02T12:00:00Z","ends_at":"2026-10-02T13:00:00Z"}')))));
 perform pg_temp.require((select count(*)=1 and min(starts_at)='2026-10-02T12:00:00Z'::timestamptz from public.external_calendar_events_v1 where user_id=uid),'Moved occurrence updates one identity');
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{}');
 begin
   perform public.external_calendar_service_v1('apply',uid,'staging',payload||cl||jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('id',source_id,'events',jsonb_build_array(event||'{"title":"Must roll back"}',event||'{"provider_event_id":"invalid-row","ends_at":"2026-09-01T00:00:00Z"}')))));
   raise exception 'Invalid second row accepted';
 exception when check_violation then null;end;
 perform pg_temp.require((select title='Outside event' from public.external_calendar_events_v1 where user_id=uid),'An invalid row rolls back every earlier upsert');
 perform public.external_calendar_service_v1('fail',uid,'staging',cl||'{"error_code":"invalid_provider_event"}');
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{}');
 begin perform public.external_calendar_service_v1('apply',uid,'staging',payload||cl||'{"sources":[]}');raise exception 'Partial source set accepted';exception when invalid_parameter_value then null;end;
 perform public.external_calendar_service_v1('fail',uid,'staging',cl||'{"error_code":"timeout"}');
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where user_id=uid),'Failed snapshot retains copies');
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');revision:=(result->'connection'->>'revision')::bigint;
 perform public.external_calendar_service_v1('pause',uid,'staging',jsonb_build_object('expected_revision',revision));
 begin perform public.external_calendar_service_v1('select_sources',uid,'staging',jsonb_build_object('expected_revision',revision,'source_ids','[]'::jsonb));raise exception 'Late selection overwrote pause';exception when invalid_parameter_value then null;end;
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where user_id=uid),'Pause retains copies');
 begin perform public.external_calendar_service_v1('connect',uid,'staging',jsonb_build_object('provider_subject','different-sub','account_label','Different','credentials','{}'::jsonb,'expected_connection',con->>'id','expected_generation',revision+1));raise exception 'Account switch accepted';exception when invalid_parameter_value then null;end;
 perform public.external_calendar_service_v1('connect',uid,'production','{"provider_subject":"google-sub-one","account_label":"Fixture","credentials":{"sealed":true}}');
 perform pg_temp.as_user(uid);
 perform pg_temp.require(jsonb_array_length(public.read_external_calendar_events_v1('staging','2026-10-01','2026-11-01'))=1,'Owned RC readable');
 perform pg_temp.require(jsonb_array_length(public.read_external_calendar_events_v1('production','2026-10-01','2026-11-01'))=0,'Production never sees RC copies');

 result:=public.external_calendar_device_service_v1('device_connect',uid,'staging','{"device_id":"device-owner-000001","sources":[{"native_id":"icloud-source","label":"Personal","kind":"caldav","account_label":"iCloud"}]}');
 native_id:=(result->'sources'->0->>'id')::uuid;revision:=(result->'connection'->>'revision')::bigint;
 perform pg_temp.require(result->'connection'->>'status'='paused','Device remains paused until first successful import');
 result:=public.external_calendar_device_service_v1('device_select_sources',uid,'staging',jsonb_build_object('device_id','device-owner-000001','expected_revision',revision,'source_ids',jsonb_build_array(native_id)));
 revision:=(result->'connection'->>'revision')::bigint;
 payload:=jsonb_build_object('device_id','device-owner-000001','expected_revision',revision,'manual',true,'start','2026-10-01','end','2026-11-01','sources',jsonb_build_array(jsonb_build_object('id',native_id,'events',jsonb_build_array(event))));
 result:=public.external_calendar_device_service_v1('device_snapshot',uid,'staging',payload);
 perform pg_temp.require((select count(*)=2 from public.external_calendar_events_v1 where user_id=uid),'Google and native coexist');
 begin perform public.external_calendar_device_service_v1('device_snapshot',uid,'staging',payload);raise exception 'Older device snapshot accepted';exception when invalid_parameter_value then null;end;
 revision:=(result->'connection'->>'revision')::bigint;
 begin perform public.external_calendar_device_service_v1('device_snapshot',uid,'staging',payload||jsonb_build_object('expected_revision',revision,'sources',jsonb_build_array(jsonb_build_object('id',source_id,'events',jsonb_build_array(event)))));raise exception 'Native writes Google source';exception when invalid_parameter_value then null;end;
 begin perform public.external_calendar_device_service_v1('device_connect',uid,'staging',jsonb_build_object('device_id','different-device-02','expected_revision',revision,'sources','[]'::jsonb));raise exception 'Implicit device takeover';exception when insufficient_privilege then null;end;
 result:=public.external_calendar_device_service_v1('device_select_sources',uid,'staging',jsonb_build_object('device_id','device-owner-000001','expected_revision',revision,'source_ids',jsonb_build_array(native_id),'google_bindings',jsonb_build_object(native_id::text,source_id)));
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where user_id=uid),'Explicit Google ownership removes duplicate native projection only');
 revision:=(result->'connection'->>'revision')::bigint;
 perform public.external_calendar_device_service_v1('device_disconnect',uid,'staging',jsonb_build_object('device_id','device-owner-000001','expected_revision',revision));
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where user_id=uid),'Device disconnect preserves Google copies');
end$$;
select pg_temp.require(not has_function_privilege('authenticated','public.external_calendar_service_v1(text,uuid,text,jsonb)','EXECUTE'),'User cannot invoke server Google mutations');
select pg_temp.require(not has_function_privilege('authenticated','public.external_calendar_device_service_v1(text,uuid,text,jsonb)','EXECUTE'),'User cannot impersonate owner through RPC');
select pg_temp.require(not has_table_privilege('authenticated','public.external_calendar_events_v1','INSERT,UPDATE,DELETE'),'Projection is not client-writable');
select pg_temp.require(not has_table_privilege('authenticated','private.external_calendar_connections','SELECT'),'No token read privileges');
set local role authenticated;
select pg_temp.as_user('90000000-0000-4000-8000-000000000001');
select pg_temp.require((select count(*)=1 from public.external_calendar_events_v1),'Authenticated owner can read its rows');
select pg_temp.as_user('90000000-0000-4000-8000-000000000002');
select pg_temp.require(jsonb_array_length(public.read_external_calendar_events_v1('staging','2026-10-01','2026-11-01'))=0,'Another account sees no projection');
reset role;
select pg_temp.require((select (select count(*) from public.user_events)=r.n and (select md5(coalesce(string_agg(row_to_json(e)::text,'' order by id),'')) from public.user_events e)=r.checksum from authored_receipt r),'Authored event rows exactly preserved');
rollback;
