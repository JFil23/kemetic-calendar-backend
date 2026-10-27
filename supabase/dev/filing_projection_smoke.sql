-- Disposable local database only. Candidate DDL and all fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local jit = off;
set local track_functions = 'all';
\ir fixtures/filing_view_before_projection_refactor.v1.sql

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%', message; end if; end $$;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-00000000c901','authenticated','authenticated','projection-owner@example.test',now(),now()),
 ('00000000-0000-4000-8000-00000000c902','authenticated','authenticated','projection-other@example.test',now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c901',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000c901","role":"authenticated"}',true);
select public.ensure_personal_calendar_for_user();
create temp table fixture_flows as
with inserted as (
 insert into public.flows(user_id,name,active,is_hidden,is_reminder,notes,ai_metadata)
 select '00000000-0000-4000-8000-00000000c901','Projection fixture '||n,n<>2,n=3,n=4,'',
 jsonb_build_object('notes',jsonb_build_array(jsonb_build_object('action_id','projection-action-'||n)))
 from generate_series(1,8) n returning id,name
) select id,split_part(name,' ',3)::integer as flow_number from inserted;
-- Keep legacy action-only references for the same canonical fallback resolver.
set local session_replication_role = replica;
insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,ends_at,all_day,flow_local_id,action_id,category)
select '00000000-0000-4000-8000-00000000c901',public.ensure_personal_calendar_for_user(),
 case when n%7=0 then 'reminder:projection-'||n else 'projection-fixture-'||n end,
 'Projection fixture', now()+(n-120)*interval '1 hour',
 case when n%3=0 then null else now()+(n-120)*interval '1 hour'+interval '30 minutes' end,
 n%3=0,case when n%5=0 then null else f.id end,
 case when n%10=0 then null else 'projection-action-'||f.flow_number end,
 case when n%11=0 then 'tombstone' else null end
from generate_series(1,240) n join fixture_flows f on f.flow_number=n%8+1;
set local session_replication_role = origin;
analyze public.flows;
analyze public.user_events;

set local role authenticated;
create temp table before_rows as select id,to_jsonb(x) as row from public.user_event_filing_items_client x;
select pg_temp.assert_true((select count(distinct row->>'item_kind')=3 from before_rows),'Fixture does not cover all filing kinds');
create temp table before_pages as
select kind,page_offset,boundary,
 (select jsonb_agg(to_jsonb(x) order by x.starts_at desc,x.id desc)
  from public.get_owned_filing_page_v1(kind,page_offset,50,boundary) x) as rows
from unnest(array['note','reminder','flow']) kind
cross join unnest(array[0,50,100,300]) page_offset
cross join (values(null::timestamptz),(now())) b(boundary);

create temp table measured_calls as select 'before'::text as phase,
 coalesce((select calls from pg_stat_xact_user_functions where funcid='public._get_user_timezone(uuid)'::regprocedure),0) as calls,
 coalesce((select calls from pg_stat_xact_user_functions where funcid='public.flow_id_from_action_id(uuid,text)'::regprocedure),0) as ownership_calls;
select count(*) from public.get_owned_filing_page_v1('reminder',0,50,null);
update measured_calls set calls=coalesce((select calls from pg_stat_xact_user_functions where funcid='public._get_user_timezone(uuid)'::regprocedure),0)-calls, ownership_calls=coalesce((select calls from pg_stat_xact_user_functions where funcid='public.flow_id_from_action_id(uuid,text)'::regprocedure),0)-ownership_calls;
reset role;
\ir ../migrations/20261027194710_simplify_filing_read_projection.sql
set local role authenticated;
select pg_temp.assert_true(not exists(
 (select row from before_rows except select to_jsonb(x) from public.user_event_filing_items_client x)
 union all
 (select to_jsonb(x) from public.user_event_filing_items_client x except select row from before_rows)
),'Full filing payload changed');
select pg_temp.assert_true(not exists(
 select 1 from before_pages b where b.rows is distinct from
 (select jsonb_agg(to_jsonb(x) order by x.starts_at desc,x.id desc)
  from public.get_owned_filing_page_v1(b.kind,b.page_offset,50,b.boundary) x)
),'Page ordering, offsets, kind or date coverage changed');

insert into measured_calls select 'after',coalesce((select calls from pg_stat_xact_user_functions where funcid='public._get_user_timezone(uuid)'::regprocedure),0),coalesce((select calls from pg_stat_xact_user_functions where funcid='public.flow_id_from_action_id(uuid,text)'::regprocedure),0);
select count(*) from public.get_owned_filing_page_v1('reminder',0,50,null);
update measured_calls set calls=coalesce((select calls from pg_stat_xact_user_functions where funcid='public._get_user_timezone(uuid)'::regprocedure),0)-calls, ownership_calls=coalesce((select calls from pg_stat_xact_user_functions where funcid='public.flow_id_from_action_id(uuid,text)'::regprocedure),0)-ownership_calls where phase='after';
select phase,calls as timezone_calls,ownership_calls from measured_calls order by phase;
select pg_temp.assert_true(
 (select calls from measured_calls where phase='after') < (select calls from measured_calls where phase='before'),
 'Refactor did not reduce repeated timezone work');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c902',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000c902","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=0 from public.user_event_filing_items_client),'Other account gained private filing rows');
reset role;
select pg_temp.assert_true((select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.user_event_filing_items_client'::regclass),'Filing bypasses caller RLS');
select pg_temp.assert_true(not has_function_privilege('anon','public.get_owned_filing_page_v1(text,integer,integer,timestamp with time zone)','execute'),'Anonymous filing RPC access changed');
rollback;
