-- Disposable local schema only. Every fixture and mutation rolls back.
begin;
create function pg_temp.require(p_ok boolean,p_message text) returns void language plpgsql as $$ begin if coalesce(p_ok,false) is not true then raise exception '%',p_message; end if; end $$;
create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',p_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
end $$;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-00000000ac01','authenticated','authenticated','ask-owner@example.test',now(),now()),
 ('00000000-0000-4000-8000-00000000ac02','authenticated','authenticated','ask-other@example.test',now(),now()),
 ('00000000-0000-4000-8000-00000000ac03','authenticated','authenticated','ask-reader@example.test',now(),now());
insert into public.profiles(id,email,handle,display_name,is_discoverable,timezone) values
 ('00000000-0000-4000-8000-00000000ac01','ask-owner@example.test','askowner','Owner',true,'America/Los_Angeles'),
 ('00000000-0000-4000-8000-00000000ac02','ask-other@example.test','askother','Other',true,'America/Los_Angeles'),
 ('00000000-0000-4000-8000-00000000ac03','ask-reader@example.test','askreader','Reader',true,'America/Los_Angeles') on conflict(id) do update set timezone=excluded.timezone;
insert into public.shared_calendars(id,owner_id,name,is_personal) values
 ('10000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac01','Ask fixture',true),
 ('10000000-0000-4000-8000-00000000ac02','00000000-0000-4000-8000-00000000ac02','Other fixture',true);
insert into public.shared_calendar_members(calendar_id,user_id,role,status) values
 ('10000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac01','owner','accepted'),
 ('10000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac03','viewer','accepted'),
 ('10000000-0000-4000-8000-00000000ac02','00000000-0000-4000-8000-00000000ac02','owner','accepted') on conflict(calendar_id,user_id) do update set role=excluded.role,status=excluded.status;
insert into public.flows(id,user_id,calendar_id,name,start_date,assistance) values
 (910001,'00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','Ask authored Flow',current_date,'{"version":1,"steps":[{"id":"begin","duration_minutes":10}]}'),
 (910002,'00000000-0000-4000-8000-00000000ac02','10000000-0000-4000-8000-00000000ac02','Private cooking Flow',current_date,null);
insert into public.user_events(id,user_id,client_event_id,calendar_id,title,starts_at,ends_at,flow_local_id,behavior_payload) values
 ('30000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac01','ask-history','10000000-0000-4000-8000-00000000ac01','History',now()-interval '5 days',now()-interval '5 days'+interval '10 minutes',910001,'{"ask_haw":{"step_id":"begin"}}'),
 ('30000000-0000-4000-8000-00000000ac02','00000000-0000-4000-8000-00000000ac01','ask-future','10000000-0000-4000-8000-00000000ac01','Future',now()+interval '1 day',now()+interval '1 day 10 minutes',910001,null),
 ('30000000-0000-4000-8000-00000000ac03','00000000-0000-4000-8000-00000000ac02','ask-private','10000000-0000-4000-8000-00000000ac02','Private',now()+interval '2 days',now()+interval '2 days 1 hour',910002,null);
insert into public.user_event_completions(user_id,client_event_id,flow_id,completed_on,metadata) values
 ('00000000-0000-4000-8000-00000000ac01','ask-history',910001,current_date-5,'{"completion_status":"partial"}');
insert into public.scheduled_notifications(user_id,client_event_id,notification_id,title,scheduled_at,notification_type) values
 ('00000000-0000-4000-8000-00000000ac01','ask-future',991001,'Future notification',now()+interval '23 hours','event_start');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
do $$
declare a uuid:='00000000-0000-4000-8000-00000000ac01'; first jsonb; r jsonb; rev bigint;
begin
  r:=public.read_ask_haw_memory_v1(a);
  perform pg_temp.require(r#>>'{row,revision}'='0','empty memory is revision zero');
  first:=public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac01',0,0,'patch','{"phrases":{"evening reset":{"flow_id":910001}},"preferences":{"minutes":10,"quiet":true}}');
  perform pg_temp.require(first->>'status'='applied','confirmed memory applies');
  r:=public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac01',0,0,'patch','{"phrases":{"evening reset":{"flow_id":910001}},"preferences":{"minutes":10,"quiet":true}}');
  perform pg_temp.require(r=first,'lost memory acknowledgement is idempotent');
  begin
    perform public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac01',0,0,'patch','{"other":true}');
    raise exception 'memory mutation identity reuse accepted';
  exception when invalid_parameter_value then null; end;
  r:=public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac02',1,0,'patch','{"preferences":{"minutes":5,"quiet":null}}');
  perform pg_temp.require(r#>>'{row,payload,preferences,minutes}'='5' and not(r#>'{row,payload,preferences}'?'quiet') and r#>>'{row,payload,phrases,evening reset,flow_id}'='910001','patch preserves unrelated meanings and supports corrections/deletion');
  r:=public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac03',0,0,'patch','{"stale":true}');
  perform pg_temp.require(r->>'status'='conflict','stale memory edit conflicts');
  r:=public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac04',2,0,'clear','{}');
  perform pg_temp.require(r#>>'{row,epoch}'='1' and r#>'{row,payload}'='{}'::jsonb,'clear advances epoch');
  r:=public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac05',3,0,'patch','{"resurrected":true}');
  perform pg_temp.require(r->>'status'='conflict','queued learning cannot survive clear');
  r:=public.apply_ask_haw_memory_v1(a,'20000000-0000-4000-8000-00000000ac01',0,0,'patch','{"phrases":{"evening reset":{"flow_id":910001}},"preferences":{"minutes":10,"quiet":true}}');
  perform pg_temp.require(r->>'status'='superseded' and r#>>'{row,epoch}'='1','old acknowledgement cannot republish cleared memory');
  begin perform public.read_ask_haw_memory_v1('00000000-0000-4000-8000-00000000ac02'); raise exception 'other memory readable'; exception when insufficient_privilege then null; end;
  begin perform (select count(*) from private.ask_haw_memory); raise exception 'memory directly readable'; exception when insufficient_privilege then null; end;
  r:=public.read_ask_haw_context_v1(a,now(),now()+interval '3 days');
  perform pg_temp.require(r->>'status'='ready' and r#>>'{coverage,complete}'='true','bounded context complete');
  perform pg_temp.require(r->>'timezone'='America/Los_Angeles','IANA timezone preserved');
  perform pg_temp.require(r#>>'{step_completions,910001,begin}'='partial','historic step completion beyond window retained');
  perform pg_temp.require(not exists(select 1 from jsonb_array_elements(r->'events') e where e->>'client_event_id'='ask-private'),'context does not leak other account');
  perform pg_temp.require(r->>'personal_calendar_id'='10000000-0000-4000-8000-00000000ac01','context resolves personal identity without creating one');
  update public.user_events set location='older client' where id='30000000-0000-4000-8000-00000000ac02';
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac01','[{"kind":"event_patch","id":"30000000-0000-4000-8000-00000000ac02","expected_revision":1,"patch":{"title":"stale"}},{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-atomic","event":{"title":"Atomic","starts_at":"2040-01-02T10:00:00Z"}}]');
  perform pg_temp.require(r->>'status'='conflict' and not exists(select 1 from public.user_events where client_event_id='ask-atomic'),'one stale row prevents whole batch');
  first:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac02','[{"kind":"event_patch","id":"30000000-0000-4000-8000-00000000ac02","expected_revision":2,"patch":{"title":"Moved","starts_at":"2040-01-02T10:00:00Z","ends_at":"2040-01-02T10:10:00Z"}}]');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac02','[{"kind":"event_patch","id":"30000000-0000-4000-8000-00000000ac02","expected_revision":2,"patch":{"title":"Moved","starts_at":"2040-01-02T10:00:00Z","ends_at":"2040-01-02T10:10:00Z"}}]');
  perform pg_temp.require(first=r and r#>>'{rows,0,row,client_event_id}'='ask-future' and r#>>'{rows,0,row,flow_local_id}'='910001','move preserves occurrence identity and retry receipt');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac03','[{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-overlap","avoid_conflicts":true,"event":{"title":"Overlap","starts_at":"2040-01-02T10:05:00Z","ends_at":"2040-01-02T10:15:00Z"}}]');
  perform pg_temp.require(r->>'status'='conflict' and not exists(select 1 from public.user_events where client_event_id='ask-overlap'),'server rechecks overlap at apply');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac04','[{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-created","avoid_conflicts":true,"event":{"title":"Created","starts_at":"2040-01-02T11:00:00Z","ends_at":"2040-01-02T11:10:00Z"}}]');
  perform pg_temp.require(r->>'status'='applied','nonconflicting create applies');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac05','[{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-created","event":{"title":"Again","starts_at":"2040-01-03T11:00:00Z"}}]');
  perform pg_temp.require(r->>'status'='conflict' and (select count(*)=1 from public.user_events where client_event_id='ask-created'),'stable identity cannot duplicate under new mutation');
  select assistance_revision into rev from public.flows where id=910001;
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac06',jsonb_build_array(jsonb_build_object('kind','flow_pause','id',910001,'expected_revision',rev)));
  perform pg_temp.require(r->>'status'='applied' and (select paused_at is not null and active from public.flows where id=910001),'pause is reversible state, not end');
  perform pg_temp.require((select flow_suspended from public.user_events where client_event_id='ask-future') and not(select flow_suspended from public.user_events where client_event_id='ask-history'),'pause preserves history and suspends future');
  perform pg_temp.require((select count(*)=1 from public.user_event_completions where client_event_id='ask-history'),'pause preserves completion');
  insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,flow_local_id) values(a,'10000000-0000-4000-8000-00000000ac01','ask-old-materializer','Later',now()+interval '2 days',910001);
  perform pg_temp.require((select flow_suspended from public.user_events where client_event_id='ask-old-materializer'),'older materializer cannot bypass pause');
  perform pg_temp.require(not exists(select 1 from public.get_calendar_flow_events_v2(now(),now()+interval '3 days',array[910001],1000,0) where client_event_id='ask-old-materializer'),'live hydration suppresses future paused occurrences');
  select assistance_revision into rev from public.flows where id=910001;
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac07',jsonb_build_array(jsonb_build_object('kind','flow_resume','id',910001,'expected_revision',rev)));
  perform pg_temp.require(r->>'status'='applied' and not(select flow_suspended from public.user_events where client_event_id='ask-future'),'resume restores future rows without recreating identity');
  update public.flows set name='Older editor' where id=910001;
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac08',jsonb_build_array(jsonb_build_object('kind','flow_assistance','id',910001,'expected_revision',rev,'assistance',jsonb_build_object('version',1))));
  perform pg_temp.require(r->>'status'='conflict','old editor advances Flow revision');
end $$;
reset role;
select pg_temp.require((select not is_active and flow_pause_suppressed from public.scheduled_notifications where client_event_id='ask-future') is not true,'resume restores still-future notification');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac03');
do $$ begin
  begin
    perform public.apply_ask_haw_actions_v1('00000000-0000-4000-8000-00000000ac03','40000000-0000-4000-8000-00000000ac09','[{"kind":"event_patch","id":"30000000-0000-4000-8000-00000000ac02","expected_revision":4,"patch":{"title":"Reader attack"}}]');
    raise exception 'viewer can mutate shared event';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Shared editors keep existing permission parity; readers never gain it.
update public.shared_calendar_members set role='editor' where user_id='00000000-0000-4000-8000-00000000ac03';
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac03');
do $$ declare r jsonb; rev bigint; begin
 select event_revision into rev from public.user_events where client_event_id='ask-future';
 r:=public.apply_ask_haw_actions_v1('00000000-0000-4000-8000-00000000ac03','40000000-0000-4000-8000-00000000ac10',jsonb_build_array(jsonb_build_object('kind','event_patch','id','30000000-0000-4000-8000-00000000ac02','expected_revision',rev,'patch',jsonb_build_object('location','Shared editor'))));
 perform pg_temp.require(r->>'status'='applied','accepted editor may edit the existing calendar owner row');
end $$;
reset role;
-- Cross-midnight and all-day rows overlap a context window even when their
-- start is before it. No point-in-time preview can stand in for this coverage.
insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,ends_at,all_day) values
 ('00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','ask-cross-midnight','Overnight','2041-03-09T07:30:00Z','2041-03-09T09:00:00Z',false),
 ('00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','ask-all-day','All day','2041-03-09T08:00:00Z',null,true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
do $$ declare r jsonb; begin
 r:=public.read_ask_haw_context_v1('00000000-0000-4000-8000-00000000ac01','2041-03-09T08:30:00Z','2041-03-09T09:30:00Z');
 perform pg_temp.require((select count(*)=2 from jsonb_array_elements(r->'events')e where e->>'client_event_id' in('ask-cross-midnight','ask-all-day')),'overlap read retains cross-midnight and all-day rows');
 r:=public.apply_ask_haw_actions_v1('00000000-0000-4000-8000-00000000ac01','40000000-0000-4000-8000-00000000ac11','[{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-all-day-conflict","avoid_conflicts":true,"event":{"title":"Overlap","starts_at":"2041-03-09T18:00:00Z","ends_at":"2041-03-09T18:10:00Z"}}]');
 perform pg_temp.require(r->>'status'='conflict','all-day commitment blocks proposed scheduling');
 r:=public.apply_ask_haw_actions_v1('00000000-0000-4000-8000-00000000ac01','40000000-0000-4000-8000-00000000ac12','[{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-stale-contract","expected_flow_revision":1,"event":{"title":"Stale authored contract","flow_local_id":910001,"starts_at":"2041-03-10T18:00:00Z"}}]');
 perform pg_temp.require(r->>'status'='conflict','authored contract revision is rechecked at commit');
 r:=public.apply_ask_haw_actions_v1('00000000-0000-4000-8000-00000000ac01','40000000-0000-4000-8000-00000000ac13','[{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-batch-a","avoid_conflicts":true,"event":{"title":"One","starts_at":"2042-01-01T10:00:00Z","ends_at":"2042-01-01T10:20:00Z"}},{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-batch-b","avoid_conflicts":true,"event":{"title":"Two","starts_at":"2042-01-01T10:10:00Z","ends_at":"2042-01-01T10:30:00Z"}}]');
 perform pg_temp.require(r->>'status'='conflict' and not exists(select 1 from public.user_events where client_event_id in('ask-batch-a','ask-batch-b')),'competing Flows cannot claim the same gap in one batch');
 begin
   perform public.read_ask_haw_context_v1('00000000-0000-4000-8000-00000000ac01',now(),now()+interval '32 days');
   raise exception 'unbounded context accepted';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- Full published search finds an old match beyond an unrelated recent feed.
insert into public.flow_posts(user_id,flow_id,name,color,created_at,ai_metadata)
select '00000000-0000-4000-8000-00000000ac02',910002,'Unrelated recent '||n,123,now()+n*interval '1 minute','{"payload":{"events":[]}}' from generate_series(1,35) n;
insert into public.flow_posts(id,user_id,flow_id,name,color,created_at,ai_metadata) values
 ('50000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac02',910002,'Beginner cooking',123,'2020-01-01','{"payload":{"events":[],"assistance":{"version":1}}}');
insert into public.flow_posts(id,user_id,flow_id,name,color,created_at,ai_metadata) values
 ('50000000-0000-4000-8000-00000000ac03','00000000-0000-4000-8000-00000000ac02',910002,'Reading circle',123,'2020-01-01','{"shared_note":"Books and shared readings","payload":{"events":[]}}');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
do $$ declare r jsonb; begin
 r:=public.search_ask_haw_flows_v1('00000000-0000-4000-8000-00000000ac01','beginner cooking',10);
 perform pg_temp.require(jsonb_array_length(r->'results')=1 and r#>>'{results,0,id}'='50000000-0000-4000-8000-00000000ac01','search corpus is not a bounded feed sample');
 perform pg_temp.require(public.search_ask_haw_flows_v1('00000000-0000-4000-8000-00000000ac01','read',10)#>>'{results,0,id}'='50000000-0000-4000-8000-00000000ac03' and public.search_ask_haw_flows_v1('00000000-0000-4000-8000-00000000ac01','reading',10)#>>'{results,0,id}'='50000000-0000-4000-8000-00000000ac03','published English stemming matches read and reading to actual Reading circle');
 perform pg_temp.require(r#>'{results,0,source_flow_id}'='null'::jsonb,'search does not confer private source ownership');
 perform pg_temp.require(jsonb_array_length(public.search_ask_haw_flows_v1('00000000-0000-4000-8000-00000000ac01','private cooking',10)->'results')=0,'private source title is never searched');
end $$;
reset role;
insert into public.user_blocks(blocker_user_id,blocked_user_id) values('00000000-0000-4000-8000-00000000ac02','00000000-0000-4000-8000-00000000ac01');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
select pg_temp.require(jsonb_array_length(public.search_ask_haw_flows_v1('00000000-0000-4000-8000-00000000ac01','beginner cooking',10)->'results')=0,'reverse block hides published search results');
reset role;
delete from public.user_blocks where blocker_user_id='00000000-0000-4000-8000-00000000ac02';
-- Existing event-share source/import owners carry assistance without copying
-- an account's runtime pause state or source revisions into another account.
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
insert into public.event_shares(id,event_id,sender_id,recipient_id,channel,status,response_status,payload_json) values(
 '60000000-0000-4000-8000-00000000ac01','30000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac02','in_app','sent','accepted',
 jsonb_build_object('source_flow',public.event_share_source_flow_payload('30000000-0000-4000-8000-00000000ac01')));
select pg_temp.require((select assistance=(select assistance from public.flows where id=910001) and paused_at is null from public.flows where origin_generation_id='60000000-0000-4000-8000-00000000ac01'),'authored assistance survives accepted event-share import');
create function pg_temp.resync_ask_copy(p_id uuid) returns void language plpgsql as $$
declare v_share public.event_shares%rowtype;
begin
  select * into v_share from public.event_shares where id=p_id;
  v_share.payload_json:=jsonb_build_object('source_flow',public.event_share_source_flow_payload(v_share.event_id));
  perform public.sync_event_share_calendar_copy_from_row(v_share);
end $$;
-- Initial copying carries opaque future versions. Subsequent source refreshes
-- cannot overwrite recipient-owned assistance edits, disablement or removal.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
update public.flows set assistance='{"version":99,"recipient_future":{"opaque":true}}' where origin_generation_id='60000000-0000-4000-8000-00000000ac01';
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
update public.flows set assistance='{"version":42,"future_source":{"opaque":true}}' where id=910001;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
select pg_temp.resync_ask_copy('60000000-0000-4000-8000-00000000ac01');
select pg_temp.require((select assistance='{"version":99,"recipient_future":{"opaque":true}}'::jsonb from public.flows where origin_generation_id='60000000-0000-4000-8000-00000000ac01'),'source sync preserves recipient future-version edit');
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
insert into public.event_shares(id,event_id,sender_id,recipient_id,channel,status,response_status,payload_json) values(
 '60000000-0000-4000-8000-00000000ac02','30000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac01','00000000-0000-4000-8000-00000000ac02','in_app','sent','accepted',
 jsonb_build_object('source_flow',public.event_share_source_flow_payload('30000000-0000-4000-8000-00000000ac01')));
select pg_temp.require((select assistance='{"version":42,"future_source":{"opaque":true}}'::jsonb from public.flows where origin_generation_id='60000000-0000-4000-8000-00000000ac02'),'new recipient copy preserves opaque future source contract');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
update public.flows set assistance='{"version":1,"steps":[],"adaptations":[]}' where origin_generation_id='60000000-0000-4000-8000-00000000ac01';
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
select pg_temp.resync_ask_copy('60000000-0000-4000-8000-00000000ac01');
select pg_temp.require((select assistance='{"version":1,"steps":[],"adaptations":[]}'::jsonb from public.flows where origin_generation_id='60000000-0000-4000-8000-00000000ac01'),'source sync preserves explicit empty supported recipient contract');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
update public.flows set assistance=null where origin_generation_id='60000000-0000-4000-8000-00000000ac01';
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac02');
select pg_temp.resync_ask_copy('60000000-0000-4000-8000-00000000ac01');
select pg_temp.require((select assistance is null from public.flows where origin_generation_id='60000000-0000-4000-8000-00000000ac01'),'source sync preserves explicit recipient removal');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
do $$ declare r jsonb; rev bigint; frev bigint; patch jsonb; begin
  perform pg_temp.require((select scheduled_at='2040-01-02T09:00:00Z'::timestamptz from public.scheduled_notifications where client_event_id='ask-future' and notification_type='event_start'),'move preserves notification delta and ID');
  update public.flows set assistance='{"version":1,"adaptations":["shorten"],"steps":[{"id":"begin","title":"Begin","minutes":10,"alternatives":[{"id":"quick","minutes":5,"countsAsCompletion":false}]}]}' where id=910001;
  insert into public.scheduled_notifications(user_id,client_event_id,notification_id,title,scheduled_at,notification_type)
    values('00000000-0000-4000-8000-00000000ac01','ask-future',991002,'End alert','2040-01-02T10:08:00Z','event_end');
  select event_revision into rev from public.user_events where client_event_id='ask-future';
  select assistance_revision into frev from public.flows where id=910001;
  patch:=jsonb_build_object('ends_at','2040-01-02T10:05:00Z','behavior_payload',jsonb_build_object('ask_haw',jsonb_build_object('step_id','begin','alternative_id','quick','contract_version',1,'counts_as_completion',true)));
  begin
    perform public.apply_ask_haw_actions_v1('00000000-0000-4000-8000-00000000ac01','40000000-0000-4000-8000-00000000ac14',jsonb_build_array(jsonb_build_object('kind','event_patch','id','30000000-0000-4000-8000-00000000ac02','expected_revision',rev,'expected_flow_revision',frev,'patch',patch)));
    raise exception 'forged alternative completion accepted';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.require((select ends_at='2040-01-02T10:10:00Z'::timestamptz from public.user_events where client_event_id='ask-future'),'rejected adaptation changes no row');
  patch:=jsonb_set(patch,'{behavior_payload,ask_haw,counts_as_completion}','false');
  r:=public.apply_ask_haw_actions_v1('00000000-0000-4000-8000-00000000ac01','40000000-0000-4000-8000-00000000ac15',jsonb_build_array(jsonb_build_object('kind','event_patch','id','30000000-0000-4000-8000-00000000ac02','expected_revision',rev,'expected_flow_revision',frev,'patch',patch)));
  perform pg_temp.require(r->>'status'='applied','authored alternative applies');
  perform pg_temp.require((select scheduled_at='2040-01-02T10:03:00Z'::timestamptz and notification_id=991002 from public.scheduled_notifications where client_event_id='ask-future' and notification_type='event_end'),'shortening preserves end-alert offset and ID');
  perform public.record_event_completion('ask-future',910001,'2040-01-02');
  r:=public.read_ask_haw_context_v1('00000000-0000-4000-8000-00000000ac01','2040-01-02','2040-01-03');
  perform pg_temp.require((select e->>'completion_status'='observed' from jsonb_array_elements(r->'events')e where e->>'client_event_id'='ask-future'),'actual occurrence completion remains observed');
  perform pg_temp.require(r#>>'{step_completions,910001,begin}'='unknown','noncredit alternative does not satisfy prerequisite');
end $$;
reset role;

-- Astronomy anchors remain fixed even when a client forges an authored
-- reschedule/shorten allowance. Protect Time remains an ordinary event.
insert into public.flows(id,user_id,calendar_id,name,notes,ai_metadata,assistance,rules) values
 (910003,'00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','Follow the Sky','maat=track-the-sky;track_sky_schema=2','{"flow_key":"track-the-sky"}',
  '{"version":1,"adaptations":["shorten","reschedule"],"steps":[{"id":"observe","minutes":10,"alternatives":[{"id":"short","minutes":5,"countsAsCompletion":true}]}]}','[]'),
 (910004,'00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','Repeating authored step',null,null,
  '{"version":1,"steps":[{"id":"practice","minutes":10}]}','[{"type":"week","weekdays":[1,2,3,4,5,6,7]}]'),
 (910005,'00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','Unscheduled authored sequence',null,null,
  '{"version":1,"steps":[{"id":"practice","minutes":10}]}','[]');
insert into public.user_events(id,user_id,calendar_id,client_event_id,title,starts_at,ends_at,flow_local_id,action_id,behavior_payload) values
 ('30000000-0000-4000-8000-00000000ac04','00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','ask-sky-anchor','Catalog sky anchor','2046-01-01T20:00Z','2046-01-01T21:00Z',910003,null,'{"kind":"track_sky_v2","trackSkySchemaVersion":2,"skyEventId":"sky-anchor"}'),
 ('30000000-0000-4000-8000-00000000ac05','00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','ask-detached-sky','Detached sky anchor','2046-02-01T20:00Z','2046-02-01T21:00Z',null,null,'{"kind":"track_sky_v2","trackSkySchemaVersion":2,"skyEventId":"detached-anchor"}'),
 ('30000000-0000-4000-8000-00000000ac06','00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','ask-protect-time','Protect Time','2046-03-01T20:00Z','2046-03-01T21:00Z',null,'follow_the_sky.protect_time','{"createdBy":"follow_the_sky","trackSkyCourseId":"course"}');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
do $$ declare a uuid:='00000000-0000-4000-8000-00000000ac01'; r jsonb; x jsonb; first_id uuid; rev bigint;
begin
  begin
    perform public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac31','[{"kind":"event_patch","id":"30000000-0000-4000-8000-00000000ac04","expected_revision":1,"expected_flow_revision":1,"patch":{"starts_at":"2046-01-02T20:00Z","ends_at":"2046-01-02T21:00Z"}}]');
    raise exception 'moved astronomy anchor';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac32','[{"kind":"event_patch","id":"30000000-0000-4000-8000-00000000ac05","expected_revision":1,"patch":{"ends_at":"2046-02-01T20:05Z"}}]');
    raise exception 'shortened detached astronomy anchor';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.require((select starts_at='2046-01-01T20:00Z'::timestamptz and event_revision=1 from public.user_events where client_event_id='ask-sky-anchor'),'anchor rejection preserves exact source interval');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac33','[{"kind":"event_patch","id":"30000000-0000-4000-8000-00000000ac06","expected_revision":1,"patch":{"starts_at":"2046-03-02T20:00Z","ends_at":"2046-03-02T21:00Z"}}]');
  perform pg_temp.require(r->>'status'='applied','ordinary Protect Time block stays editable');
  x:='{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-period-first","expected_flow_revision":1,"event":{"title":"Authored practice","starts_at":"2047-07-02T06:00Z","ends_at":"2047-07-02T06:10Z","flow_local_id":910004,"behavior_payload":{"ask_haw":{"step_id":"practice","contract_version":1,"counts_as_completion":true}}}}';
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac34',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='applied' and r#>>'{rows,0,row,ask_haw_period_key}'='day:2047-07-01','period uses source IANA civil day');
  first_id:=(r#>>'{rows,0,row,id}')::uuid;
  x:=jsonb_set(x,'{client_event_id}','"ask-period-duplicate"');
  x:=jsonb_set(x,'{event,starts_at}','"2047-07-02T05:00Z"');x:=jsonb_set(x,'{event,ends_at}','"2047-07-02T05:10Z"');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac35',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='conflict' and r#>>'{rows,0,kind}'='duplicate_flow_step','new UUID and different slot cannot duplicate same step period');
  x:=jsonb_set(x,'{client_event_id}','"ask-period-next"');
  x:=jsonb_set(x,'{event,starts_at}','"2047-07-02T07:00Z"');x:=jsonb_set(x,'{event,ends_at}','"2047-07-02T07:10Z"');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac36',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='applied' and r#>>'{rows,0,row,ask_haw_period_key}'='day:2047-07-02','legitimate next local repeat period is allowed on same UTC date');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac37',jsonb_build_array(jsonb_build_object('kind','event_patch','id',first_id,'expected_revision',1,'expected_flow_revision',1,'patch',jsonb_build_object('starts_at','2047-07-04T06:00Z','ends_at','2047-07-04T06:10Z'))));
  perform pg_temp.require(r->>'status'='applied' and r#>>'{rows,0,row,ask_haw_period_key}'='day:2047-07-01','move preserves original occurrence period');
  x:=jsonb_set(x,'{client_event_id}','"ask-period-moved-duplicate"');
  x:=jsonb_set(x,'{event,starts_at}','"2047-07-02T04:00Z"');x:=jsonb_set(x,'{event,ends_at}','"2047-07-02T04:10Z"');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac38',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='conflict','moving an occurrence cannot free its original identity for duplicate proposals');
  x:=jsonb_set(x,'{client_event_id}','"ask-period-batch-a"');
  x:=jsonb_set(x,'{event,starts_at}','"2047-07-10T18:00Z"');x:=jsonb_set(x,'{event,ends_at}','"2047-07-10T18:10Z"');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac44',jsonb_build_array(x,jsonb_set(x,'{client_event_id}','"ask-period-batch-b"')));
  perform pg_temp.require(r->>'status'='conflict' and not exists(select 1 from public.user_events where client_event_id in('ask-period-batch-a','ask-period-batch-b')),'within-batch duplicate steps roll back the whole proposal');
  x:=jsonb_set(x,'{event,flow_local_id}','910005');x:=jsonb_set(x,'{client_event_id}','"ask-sequence-first"');
  x:=jsonb_set(x,'{event,starts_at}','"2049-01-01T18:00Z"');x:=jsonb_set(x,'{event,ends_at}','"2049-01-01T18:10Z"');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac39',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='applied','unscheduled sequence first step applies');
  x:=jsonb_set(x,'{client_event_id}','"ask-sequence-second"');
  x:=jsonb_set(x,'{event,starts_at}','"2049-01-02T18:00Z"');x:=jsonb_set(x,'{event,ends_at}','"2049-01-02T18:10Z"');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac40',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='conflict','ruleless active step cannot be duplicated on another proposed date');
  perform public.record_event_completion('ask-sequence-first',910005,'2049-01-01');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac40',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='conflict','conflicting request identity remains its exact prior receipt');
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac42',jsonb_build_array(x));
  perform pg_temp.require(r->>'status'='applied','finished sequence occurrence does not block intentional later repeat');
  insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,ends_at) values(a,'10000000-0000-4000-8000-00000000ac01','ask-unknown-duration','Unresolved duration','2048-01-01T10:00Z',null);
  r:=public.apply_ask_haw_actions_v1(a,'40000000-0000-4000-8000-00000000ac43','[{"kind":"event_create","calendar_id":"10000000-0000-4000-8000-00000000ac01","client_event_id":"ask-over-unknown","avoid_conflicts":true,"event":{"title":"Unknown gap","starts_at":"2048-01-02T18:00Z","ends_at":"2048-01-02T18:10Z"}}]');
  perform pg_temp.require(r->>'status'='conflict' and not exists(select 1 from public.user_events where client_event_id='ask-over-unknown'),'unresolved prior timed duration cannot be claimed as free time');
  r:=public.read_ask_haw_context_v1(a,'2048-01-02','2048-01-03');
  perform pg_temp.require(exists(select 1 from jsonb_array_elements(r->'events')e where e->>'client_event_id'='ask-unknown-duration'),'context retains possibly overlapping unknown duration from before its start');
end $$;
reset role;

-- A hard ceiling is an incomplete result, never a successful truncated plan.
insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,ends_at)
select '00000000-0000-4000-8000-00000000ac01','10000000-0000-4000-8000-00000000ac01','ask-bound-'||n,'Coverage fixture','2044-01-01T10:00:00Z','2044-01-01T10:10:00Z' from generate_series(1,5001)n;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ac01');
do $$ declare r jsonb; begin
 r:=public.read_ask_haw_context_v1('00000000-0000-4000-8000-00000000ac01','2044-01-01','2044-01-02');
 perform pg_temp.require(r->>'status'='incomplete' and r#>>'{coverage,complete}'='false' and jsonb_array_length(r->'events')=0,'context refuses incomplete coverage');
end $$;
reset role;
select pg_temp.require(not has_function_privilege('anon','public.read_ask_haw_memory_v1(uuid)','execute') and not has_function_privilege('anon','public.apply_ask_haw_actions_v1(uuid,uuid,jsonb)','execute'),'anonymous memory/actions remain inaccessible');

rollback;
