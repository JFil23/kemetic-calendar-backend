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
 begin
   perform public.external_calendar_service_v1('claim',uid,'staging','{}');
   raise exception 'Unselected connection claimed an import';
 exception when invalid_parameter_value then
   if sqlerrm<>'no_calendars_selected' then raise; end if;
 end;
 perform pg_temp.require((select last_synced_at is null and lease_token is null from private.external_calendar_connections where id=(con->>'id')::uuid),'Empty setup cannot appear synchronized or acquire a lease');
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{"catalog":true}');
 perform public.external_calendar_service_v1('sources',uid,'staging',cl||'{"sources":[{"provider_calendar_id":"outside@example.test","label":"Work"}]}');
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 source_id:=(result->'sources'->0->>'id')::uuid;revision:=(result->'connection'->>'revision')::bigint;
 perform pg_temp.require(result->'sources'->0->>'selected'='false','Consent does not select calendars');
 perform public.external_calendar_service_v1('select_sources',uid,'staging',jsonb_build_object('expected_revision',revision,'source_ids',jsonb_build_array(source_id)));
 perform pg_temp.require(jsonb_array_length(public.external_calendar_service_v1('due',null,'staging','{}'))=1,'Selected connected calendar is scheduled when due');
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{}');
 payload:=cl||jsonb_build_object('start','2026-10-01T00:00:00Z','end','2026-11-01T00:00:00Z','sources',jsonb_build_array(jsonb_build_object('id',source_id,'events',jsonb_build_array(event))));
 perform public.external_calendar_service_v1('apply',uid,'staging',payload);
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where user_id=uid),'First snapshot');
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 perform pg_temp.require((result->>'imported_event_count')::int=1 and (result->'sources'->0->>'imported_event_count')::int=1,'Counts reflect confirmed projection rows');
 result:=public.external_calendar_service_v1('create_oauth',uid,'staging','{"state_hash":"reuse-fixture","envelope":{}}');
 perform pg_temp.require(result->>'reuse_grant'='true' and result->>'provider_subject'='google-sub-one','Healthy reconnect can reuse its grant');
 result:=public.external_calendar_service_v1('consume_oauth',null,'staging','{"state_hash":"reuse-fixture"}');
 perform pg_temp.require(result->'reusable_credentials'='{"sealed":true}'::jsonb,'One-use callback carries only the fenced existing credentials');
 -- A changed connection cannot supply credentials to an old OAuth request.
 perform public.external_calendar_service_v1('create_oauth',uid,'staging','{"state_hash":"stale-reuse","envelope":{}}');
 update private.external_calendar_connections set generation=generation+1 where id=(con->>'id')::uuid;
 result:=public.external_calendar_service_v1('consume_oauth',null,'staging','{"state_hash":"stale-reuse"}');
 perform pg_temp.require(result->'reusable_credentials'='null'::jsonb,'Generation changes fence credential reuse');
 -- Restore the fixture generation so existing lease assertions stay exact.
 update private.external_calendar_connections set generation=generation-1 where id=(con->>'id')::uuid;

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
 perform pg_temp.require(jsonb_array_length(public.external_calendar_service_v1('due',null,'staging','{}'))=0,'Paused connections are never scheduled even when due');
 begin
   perform public.external_calendar_service_v1('claim',uid,'staging','{}');
   raise exception 'Worker claimed paused connection';
 exception when invalid_parameter_value then
   if sqlerrm<>'paused' then raise; end if;
 end;
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{"manual":true}');
 perform public.external_calendar_service_v1('apply',uid,'staging',payload||cl||jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('id',source_id,'events',jsonb_build_array(event||'{"title":"Manual import while paused"}')))));
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 perform pg_temp.require(result->'connection'->>'status'='paused' and result->'connection'->>'automatic'='false','Manual import never resumes automatic imports');
 perform pg_temp.require((select title='Manual import while paused' from public.external_calendar_events_v1 where user_id=uid),'Paused manual import updates its projection');
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{"manual":true}');
 perform public.external_calendar_service_v1('pause',uid,'staging',jsonb_build_object('expected_revision',result->'connection'->'revision'));
 begin
   perform public.external_calendar_service_v1('apply',uid,'staging',payload||cl);
   raise exception 'Late paused manual result crossed new pause fence';
 exception when invalid_parameter_value then
   if sqlerrm<>'stale_attempt' then raise; end if;
 end;
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 perform public.external_calendar_service_v1('resume',uid,'staging',jsonb_build_object('expected_revision',result->'connection'->'revision'));
 cl:=public.external_calendar_service_v1('claim',uid,'staging','{}');
 perform public.external_calendar_service_v1('pause',uid,'staging',jsonb_build_object('expected_revision',cl->'generation'));
 begin
   perform public.external_calendar_service_v1('apply',uid,'staging',payload||cl);
   raise exception 'Late worker result crossed pause fence';
 exception when invalid_parameter_value then
   if sqlerrm<>'stale_attempt' then raise; end if;
 end;
 perform pg_temp.require((select title='Manual import while paused' from public.external_calendar_events_v1 where user_id=uid),'Pause fences preserve last good manual snapshot');
 perform pg_temp.require(jsonb_array_length(public.external_calendar_service_v1('due',null,'staging','{}'))=0,'Paused worker remains excluded after manual import');
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 perform public.external_calendar_service_v1('connect',uid,'staging',jsonb_build_object(
   'expected_connection',con->'id','expected_generation',result->'connection'->'revision',
   'provider_subject','google-sub-one','account_label','Fixture','credentials','{}'::jsonb));
 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 perform pg_temp.require(result->'connection'->>'automatic'='false' and result->'connection'->>'status'='paused',
   'Reconnecting preserves the existing automatic-import preference');
 perform pg_temp.require(result->'sources'->0->>'selected'='true','Reconnecting preserves chosen calendars');

 result:=public.external_calendar_service_v1('status',uid,'staging','{}');
 revision:=(result->'connection'->>'revision')::bigint-1;
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
-- Account-level removal reuses the native projection owner and its generation.
do $$declare
 uid uuid:='90000000-0000-4000-8000-000000000001';
 other_uid uuid:='90000000-0000-4000-8000-000000000002';
 result jsonb; other_result jsonb; payload jsonb; first_id uuid; second_id uuid; foreign_id uuid;
 revision bigint; google_id uuid;
 event jsonb:='{"provider_event_id":"remove-fixture","recurrence_id":"time:2026-10-02T10:00:00Z","title":"Imported copy","all_day":false,"starts_at":"2026-10-02T10:00:00Z","ends_at":"2026-10-02T11:00:00Z"}';
begin
 result:=public.external_calendar_device_service_v1('device_connect',uid,'staging','{"device_id":"device-owner-000001","sources":[{"native_id":"first","label":"First"},{"native_id":"second","label":"Second"}]}');
 select id into first_id from private.external_calendar_device_sources where native_id='first' and connection_id=(result->'connection'->>'id')::uuid;
 select id into second_id from private.external_calendar_device_sources where native_id='second' and connection_id=(result->'connection'->>'id')::uuid;
 result:=public.external_calendar_device_service_v1('device_select_sources',uid,'staging',jsonb_build_object('device_id','device-owner-000001','expected_revision',result->'connection'->'revision','source_ids',jsonb_build_array(first_id,second_id)));
 payload:=jsonb_build_object('device_id','device-owner-000001','expected_revision',result->'connection'->'revision','manual',true,'start','2026-10-01','end','2026-11-01','sources',jsonb_build_array(jsonb_build_object('id',first_id,'events',jsonb_build_array(event)),jsonb_build_object('id',second_id,'events',jsonb_build_array(event))));
 result:=public.external_calendar_device_service_v1('device_snapshot',uid,'staging',payload);
 revision:=(result->'connection'->>'revision')::bigint;
 payload:=payload||jsonb_build_object('expected_revision',revision);
 other_result:=public.external_calendar_device_service_v1('device_connect',other_uid,'staging','{"device_id":"another-device-00001","sources":[{"native_id":"other","label":"Other"}]}');
 foreign_id:=(other_result->'sources'->0->>'id')::uuid;
 begin
   perform public.external_calendar_device_service_v1('device_remove_source',uid,'staging',jsonb_build_object('source_id',foreign_id,'expected_revision',revision));
   raise exception 'Removal crossed account ownership';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_sources' then raise; end if; end;
 begin
   perform public.external_calendar_device_service_v1('device_remove_source',uid,'production',jsonb_build_object('source_id',first_id,'expected_revision',revision));
   raise exception 'Removal crossed release lanes';
 exception when invalid_parameter_value then if sqlerrm<>'not_connected' then raise; end if; end;
 begin
   perform public.external_calendar_device_service_v1('device_remove_source',uid,'staging',jsonb_build_object('source_id',first_id,'expected_revision',revision-1));
   raise exception 'Removal accepted stale revision';
 exception when invalid_parameter_value then if sqlerrm<>'stale_attempt' then raise; end if; end;
 -- Unavailable source calendars can still be removed without an OS permission.
 update private.external_calendar_device_sources set available=false where id=first_id;
 result:=public.external_calendar_device_service_v1('device_remove_source',uid,'staging',jsonb_build_object('source_id',first_id,'expected_revision',revision));
 perform pg_temp.require((result->'connection'->>'revision')::bigint=revision+1,'Removal advances the existing snapshot fence');
 perform pg_temp.require(result->'connection'->>'owner_device_id'='device-owner-000001' and result->'connection'->>'status'='paused','Removal preserves native ownership and pause');
 perform pg_temp.require(not exists(select 1 from public.external_calendar_events_v1 where native_source_id=first_id),'Confirmed removal deletes all copies of that source');
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where native_source_id=second_id),'Removal preserves another imported calendar');
 perform pg_temp.require((select count(*)=1 from public.external_calendar_events_v1 where provider='google' and user_id=uid),'Removal preserves Google copies');
 perform pg_temp.require((select not selected from private.external_calendar_device_sources where id=first_id),'Removed source remains unselected');
 begin
   perform public.external_calendar_device_service_v1('device_snapshot',uid,'staging',payload);
   raise exception 'Late device snapshot recreated deleted import';
 exception when invalid_parameter_value then if sqlerrm<>'stale_attempt' then raise; end if; end;
 result:=public.external_calendar_device_service_v1('device_remove_source',uid,'staging',jsonb_build_object('source_id',first_id,'expected_revision',result->'connection'->'revision'));
 perform pg_temp.require((result->'connection'->>'revision')::bigint=revision+1,'Repeat removal at current revision is harmless');
 select s.id into google_id from private.external_calendar_sources s join private.external_calendar_connections c on c.id=s.connection_id where c.user_id=uid and c.lane='staging' limit 1;
 result:=public.external_calendar_device_service_v1('device_select_sources',uid,'staging',jsonb_build_object('device_id','device-owner-000001','expected_revision',result->'connection'->'revision','source_ids',jsonb_build_array(second_id),'google_bindings',jsonb_build_object(second_id::text,google_id)));
 begin
   perform public.external_calendar_device_service_v1('device_remove_source',uid,'staging',jsonb_build_object('source_id',second_id,'expected_revision',result->'connection'->'revision'));
   raise exception 'Removal changed Google-owned native binding';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_sources' then raise; end if; end;
 perform public.external_calendar_device_service_v1('device_disconnect',uid,'staging',jsonb_build_object('device_id','device-owner-000001','expected_revision',result->'connection'->'revision'));
 perform public.external_calendar_device_service_v1('device_disconnect',other_uid,'staging',jsonb_build_object('device_id','another-device-00001','expected_revision',other_result->'connection'->'revision'));
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
