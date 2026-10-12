-- Existing local test database only. Fixtures and candidate DDL roll back.
\set ON_ERROR_STOP on
begin;
-- Immutable deployed baseline: test old and new readers even on fresh CI databases.
create or replace function public.flow_metadata_has_action_id(
  p_ai_metadata jsonb,
  p_action_id text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(coalesce(p_action_id, '')), '') is not null
    and btrim(p_action_id) = any(public.flow_action_ids_from_metadata(p_ai_metadata))
$$;

create or replace function public.flow_id_from_action_id(
  p_user_id uuid,
  p_action_id text
)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select f.id
  from public.flows f
  where f.user_id = p_user_id
    and public.flow_metadata_has_action_id(f.ai_metadata, p_action_id)
  order by
    case public.flow_record_kind(f.active, f.is_hidden, f.is_reminder, f.notes)
      when 'active' then 0
      when 'inactive' then 1
      else 2
    end,
    f.updated_at desc nulls last,
    f.id desc
  limit 1
$$;

comment on function public.flow_id_from_action_id(uuid, text) is
'Finds the owning flow for generated event/action companion rows when the row lost flow_local_id and only kept action_id.';


create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin if ok is not true then raise exception '%',message;end if;end $$;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-00000000b901','authenticated','authenticated','fallback-owner@example.test',now(),now()),
 ('00000000-0000-4000-8000-00000000b902','authenticated','authenticated','fallback-other@example.test',now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b901',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000b901","role":"authenticated"}',true);
insert into public.flows(user_id,name,active,is_hidden,is_reminder,notes,ai_metadata)
select '00000000-0000-4000-8000-00000000b901','Fallback fixture '||n,n<>2,false,false,'',jsonb_build_object('notes',jsonb_build_array(jsonb_build_object('action_id','note-'||n)),'event_snapshot',jsonb_build_array(jsonb_build_object('action_id','snapshot-'||n)),'plan_spec',jsonb_build_object('actions',jsonb_build_array(jsonb_build_object('action_id','plan-'||n)))) from generate_series(1,3) n;
select public.ensure_personal_calendar_for_user();
-- Preserve action-only legacy rows rather than letting current write triggers repair them.
set local session_replication_role=replica;
insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,action_id)
select '00000000-0000-4000-8000-00000000b901',public.ensure_personal_calendar_for_user(),'fallback-fixture-'||n,'Fallback fixture',now()+n*interval '1 minute',case when n<4 then 'note-'||n else null end from generate_series(1,5) n;
set local session_replication_role=origin;
create temp table predicate_cases as select m.metadata,a.action_id,public.flow_metadata_has_action_id(m.metadata,a.action_id) as expected from (values(null::jsonb),('{}'::jsonb),('{"notes":[{"action_id":" one "},{"action_id":"two"}],"event_snapshot":[{"action_id":"three"}],"plan_spec":{"actions":[{"action_id":"four"}]}}'::jsonb),('{"notes":{},"event_snapshot":null,"plan_spec":{"actions":12}}'::jsonb)) m(metadata) cross join (values(null::text),(''),(' '),('one'),(' one '),('two'),('three'),('four'),('missing')) a(action_id);
create temp table lookup_cases as select a.action_id,public.flow_id_from_action_id('00000000-0000-4000-8000-00000000b901',a.action_id) as expected from (values(null::text),(''),(' '),('note-1'),(' note-2 '),('snapshot-3'),('plan-1'),('missing')) a(action_id);
set local role authenticated;
create temp table before_filing as select to_jsonb(x) as row from public.user_event_filing_items_client x;
create temp table before_flows as select to_jsonb(x) as row from public.flows_with_calendars x;
create temp table before_owned as select to_jsonb(x) as row from public.get_owned_filing_page_v1('flow',0,50,null) x;
create temp table before_hydration as select 'flow'::text as kind,to_jsonb(x) as row from public.get_calendar_flow_events_v2(now()-interval '1 day',now()+interval '1 day',(select array_agg(id) from public.flows where user_id=auth.uid()),200,0) x union all select 'note',to_jsonb(x) from public.get_calendar_standalone_events_v2(now()-interval '1 day',now()+interval '1 day',200,0) x;
reset role;
\ir ../migrations/20261012155421_optimize_flow_action_fallback_lookup.sql
select pg_temp.assert_true((select bool_and(expected is not distinct from public.flow_metadata_has_action_id(metadata,action_id)) from predicate_cases),'Metadata predicate changed');
select pg_temp.assert_true((select bool_and(expected is not distinct from public.flow_id_from_action_id('00000000-0000-4000-8000-00000000b901',action_id)) from lookup_cases),'Canonical lookup changed');
select pg_temp.assert_true(public.flow_id_from_action_id(null,'note-1') is null,'Null owner resolved another account');
set local role authenticated;
select pg_temp.assert_true(not exists((select row from before_filing except select to_jsonb(x) from public.user_event_filing_items_client x) union all (select to_jsonb(x) from public.user_event_filing_items_client x except select row from before_filing)),'Filing payload changed');
select pg_temp.assert_true(not exists((select row from before_flows except select to_jsonb(x) from public.flows_with_calendars x) union all (select to_jsonb(x) from public.flows_with_calendars x except select row from before_flows)),'Flow catalog changed');
select pg_temp.assert_true(not exists((select row from before_owned except select to_jsonb(x) from public.get_owned_filing_page_v1('flow',0,50,null) x) union all (select to_jsonb(x) from public.get_owned_filing_page_v1('flow',0,50,null) x except select row from before_owned)),'Owned filing changed');
create temp table after_hydration as select 'flow'::text as kind,to_jsonb(x) as row from public.get_calendar_flow_events_v2(now()-interval '1 day',now()+interval '1 day',(select array_agg(id) from public.flows where user_id=auth.uid()),200,0) x union all select 'note',to_jsonb(x) from public.get_calendar_standalone_events_v2(now()-interval '1 day',now()+interval '1 day',200,0) x;
select pg_temp.assert_true(not exists((select * from before_hydration except select * from after_hydration) union all (select * from after_hydration except select * from before_hydration)),'Hydration payload changed');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b902',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000b902","role":"authenticated"}',true);
select pg_temp.assert_true(public.flow_id_from_action_id('00000000-0000-4000-8000-00000000b901','note-1') is null,'Other account gained flow lookup');
select pg_temp.assert_true((select count(*)=0 from public.user_event_filing_items_client),'Other account gained filing rows');
reset role;
select pg_temp.assert_true((select not prosecdef from pg_proc where oid='public.flow_id_from_action_id(uuid,text)'::regprocedure),'Lookup bypasses caller RLS');
rollback;
