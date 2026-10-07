-- Run only in a disposable local database; all fixtures roll back.
begin;
-- Local disposable database only; all fixtures are rolled back.


create or replace function pg_temp.assert_true(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception '%', p_message;
  end if;
end;
$$;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
end;
$$;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values
(
  '00000000-0000-4000-8000-00000000ba01',
  'authenticated',
  'authenticated',
  'planner-owner@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000ba02',
  'authenticated',
  'authenticated',
  'planner-other@example.test',
  'not-used',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

insert into public.profiles (
  id,
  email,
  handle,
  display_name,
  is_discoverable
) values
(
  '00000000-0000-4000-8000-00000000ba01',
  'planner-owner@example.test',
  'plannerowner',
  'Amina',
  true
),
(
  '00000000-0000-4000-8000-00000000ba02',
  'planner-other@example.test',
  'plannerother',
  'Reader',
  true
) on conflict (id) do update
  set email = excluded.email,
      handle = excluded.handle,
      display_name = excluded.display_name,
      is_discoverable = excluded.is_discoverable;



set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba01');
do $$
declare a uuid:='00000000-0000-4000-8000-00000000ba01'; r uuid:='10000000-0000-4000-8000-00000000ba01';
 m uuid:='20000000-0000-4000-8000-00000000ba01'; x jsonb; y jsonb; rev bigint;
begin
 x:=public.apply_journal_mutation_v1(a,m,'2026-10-07',0,'{"version":1,"blocks":[{"id":"p1","type":"paragraph","ops":[{"insert":"Keep my earlier words"}]},{"id":"drawing","type":"drawing","strokes":[]}],"meta":{"original":true}}');
 perform pg_temp.assert_true(x->>'status'='applied','first Journal write');
 y:=public.apply_journal_mutation_v1(a,m,'2026-10-07',0,'{"version":1,"blocks":[{"id":"p1","type":"paragraph","ops":[{"insert":"Keep my earlier words"}]},{"id":"drawing","type":"drawing","strokes":[]}],"meta":{"original":true}}');
 perform pg_temp.assert_true(x=y,'lost acknowledgement exact retry');
 begin perform public.apply_journal_mutation_v1(a,m,'2026-10-07',0,'changed'); raise exception 'reused identity accepted'; exception when invalid_parameter_value then null; end;
 x:=public.apply_decan_review_v1(a,gen_random_uuid(),r,'2026-09-21','2026-09-30','Closing decan','{"schema":1,"question":"What stayed with you?","question_id":"carry","moments":[]}',0);
 perform pg_temp.assert_true(x->>'status'='applied','review context create');
 m:=gen_random_uuid();
 x:=public.apply_decan_journal_v1(a,m,r,'2026-10-07',1,'My own reflection');
 perform pg_temp.assert_true(x->>'status'='applied','late reflection goes in actual writing day');
 y:=public.apply_decan_journal_v1(a,m,r,'2026-10-07',1,'My own reflection');
 perform pg_temp.assert_true(x=y,'reflection retry exact receipt');
 perform pg_temp.assert_true((select count(*)=1 from public.decan_journal_sources),'one source index');
 perform pg_temp.assert_true((x->'row'->>'body')::jsonb->'blocks'->0->>'id'='p1','earlier paragraph preserved');
 perform pg_temp.assert_true((x->'row'->>'body')::jsonb->'blocks'->1->>'id'='drawing','drawing preserved');
 perform pg_temp.assert_true(jsonb_array_length((x->'row'->>'body')::jsonb->'blocks')=3,'exactly one contribution');
 perform pg_temp.assert_true((x->'row'->>'body')::jsonb->'meta'->>'original'='true','unknown metadata retained');
 y:=public.apply_journal_mutation_v1(a,gen_random_uuid(),'2026-10-07',1,'stale document');
 perform pg_temp.assert_true(y->>'status'='conflict','another editor cannot overwrite reflection');
 begin update public.journal_entries set body='old client' where user_id=a and greg_date='2026-10-07'; raise exception 'legacy overwrite accepted'; exception when serialization_failure then null; end;
 y:=public.apply_decan_journal_v1(a,gen_random_uuid(),r,'2026-10-07',2,'Edited reflection');
 perform pg_temp.assert_true(y->>'status'='applied','edit source in place');
 perform pg_temp.assert_true(jsonb_array_length((y->'row'->>'body')::jsonb->'blocks')=3,'edit no duplicate');
 y:=public.apply_journal_mutation_v1(a,gen_random_uuid(),'2026-10-07',3,'{"version":1,"blocks":[],"meta":{}}');
 perform pg_temp.assert_true(y->>'status'='applied','Journal removes source');
 y:=public.apply_decan_journal_v1(a,gen_random_uuid(),r,'2026-10-07',4,'stale retry');
 perform pg_temp.assert_true(y->>'status'='source_changed','deleted source is not resurrected');
 y:=public.apply_journal_mutation_v1(a,gen_random_uuid(),'2026-10-07',4,null,'{}',null,true);
 perform pg_temp.assert_true(y->>'status'='applied','document deletion acknowledged');
 y:=public.apply_journal_mutation_v1(a,gen_random_uuid(),'2026-10-07',0,'stale first save');
 perform pg_temp.assert_true(y->>'status'='conflict','deleted document revision retained');
 perform pg_temp.assert_true(jsonb_array_length(public.read_journal_state_v1(a,'2026-10-07')->'recovery')=2,'fresh client discovers conflicting Journal receipts');
 perform pg_temp.assert_true(not ((public.read_journal_state_v1(a,'2026-10-07')->'recovery'->0) ? 'body'),'routine Journal reads omit recovery bodies');
 perform pg_temp.assert_true(jsonb_array_length(public.read_decan_recovery_v1(a,r))=1,'removed-source draft stays recoverable');
 perform pg_temp.assert_true(public.read_decan_recovery_v1(a,r)->0->'request'->>'words'='stale retry','recoverable source words are exact');

 begin perform public.read_journal_state_v1('00000000-0000-4000-8000-00000000ba02','2026-10-07'); raise exception 'account fence failed'; exception when insufficient_privilege then null; end;
end $$;
-- Mixed-version writes preserve the contribution without freezing the whole day.
-- Each successful probe rolls back locally so the original revision assertions remain.
do $$
declare a uuid:=auth.uid(); saved text; before_revision bigint; x jsonb;
begin
 -- The source is tombstoned and the day deleted at this point.
 select revision into before_revision from public.journal_document_versions where user_id=a and greg_date='2026-10-07';
 begin
   insert into public.journal_entries(user_id,greg_date,body) values(a,'2026-10-07','{"version":1,"blocks":[{"id":"decan_reflection:10000000-0000-4000-8000-00000000ba01","type":"paragraph","ops":[{"insert":"stale words"}]}]}');
   raise exception 'legacy insert resurrected deleted source';
 exception when serialization_failure then null; end;
 begin
   insert into public.journal_entries(user_id,greg_date,body) values(a,'2026-10-07','Fresh ordinary writing');
   perform pg_temp.assert_true((select revision=before_revision+1 from public.journal_entries where user_id=a and greg_date='2026-10-07'),'legacy creation advances date ledger');
   raise exception 'rollback compatibility probe' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba02');
select pg_temp.assert_true((select count(*)=0 from public.decan_journal_sources),'other account cannot read source');
select pg_temp.assert_true((select count(*)=0 from public.journal_mutation_receipts),'other account cannot read recovery drafts');
select pg_temp.assert_true(jsonb_array_length(public.read_decan_recovery_v1(auth.uid(),'10000000-0000-4000-8000-00000000ba01'))=0,'other account cannot recover reflection words');
select pg_temp.assert_true(not has_function_privilege('anon','public.read_decan_recovery_v1(uuid,uuid)','execute'),'anonymous recovery denied');

select pg_temp.assert_true(not has_function_privilege('anon','public.apply_journal_mutation_v1(uuid,uuid,date,bigint,text,jsonb,text,boolean)','execute'),'anonymous mutation denied');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba01');
do $$
declare a uuid:='00000000-0000-4000-8000-00000000ba01'; r uuid:='10000000-0000-4000-8000-00000000ba01';
 p uuid:='30000000-0000-4000-8000-00000000ba01'; m uuid:=gen_random_uuid(); x jsonb; y jsonb;
begin
 x:=public.apply_decan_post_v1(a,m,p,r,0,'Words reviewed for sharing',true,null,'2026-10-07');
 perform pg_temp.assert_true(x->>'status'='applied','reviewed public snapshot created');
 y:=public.apply_decan_post_v1(a,m,p,r,0,'Words reviewed for sharing',true,null,'2026-10-07');
 perform pg_temp.assert_true(x=y,'publish acknowledgement retry');
 perform pg_temp.assert_true((select node_id is null and insight_entry_id is null from public.insight_posts where id=p),'no fabricated Library source');
 perform pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.get_profile_feed_cards()) c where c->>'id'=p::text and c->>'source_kind'='decan'),'canonical feed contains typed decan');
 perform pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.get_profile_feed_together_cards()) c where c->>'id'=p::text),'Together feed retains decan');
 y:=public.apply_decan_journal_v1(a,gen_random_uuid(),r,'2026-10-07',5,'New private words',true);
 perform pg_temp.assert_true(y->>'status'='applied','explicit restoration creates new private version');
 perform pg_temp.assert_true((select body_text='Words reviewed for sharing' from public.insight_posts where id=p),'private edits cannot change public snapshot');
 y:=public.apply_decan_post_v1(a,gen_random_uuid(),p,r,0,'stale',false,null,'2026-10-07');
 perform pg_temp.assert_true(y->>'status'='conflict','post stale edit rejected');
 perform pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.read_decan_recovery_v1(a,r)) d where d->'request'->>'body'='stale'),'fresh client can recover attempted post');
 begin delete from public.insight_posts where id=p; raise exception 'physical removal erased tombstone'; exception when insufficient_privilege then null; end;

 begin insert into public.insight_posts(user_id,source_kind,source_reflection_id,body_text,entry_date)
  values(a,'decan',r,'bypass','2026-10-07'); raise exception 'unreviewed insert accepted'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba02');
select pg_temp.assert_true((select count(*)=1 from public.insight_posts where source_kind='decan'),'member can read published words');
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba01');
insert into public.user_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'00000000-0000-4000-8000-00000000ba02');
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba02');
select pg_temp.assert_true((select count(*)=0 from public.insight_posts where source_kind='decan'),'reverse block excludes private predicate');
select pg_temp.assert_true((select count(*)=0 from jsonb_array_elements(public.get_profile_feed_cards()) c where c->>'source_kind'='decan'),'blocked author omitted from feed');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
select pg_temp.assert_true((select count(*)=0 from public.insight_posts where source_kind='decan'),'anonymous cannot read decan snapshots');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba01');
set local role authenticated;
do $$
declare a uuid:=auth.uid(); p uuid:='30000000-0000-4000-8000-00000000ba01'; r uuid:='10000000-0000-4000-8000-00000000ba01'; x jsonb;
begin
 x:=public.apply_decan_post_v1(a,gen_random_uuid(),p,r,1,'',false,null,'2026-10-07',true);
 perform pg_temp.assert_true(x->>'status'='applied','remove acknowledged');
 x:=public.apply_decan_post_v1(a,gen_random_uuid(),p,r,1,'stale edit',true,null,'2026-10-07');
 perform pg_temp.assert_true(x->>'status'='conflict','removed post cannot reappear');
 perform pg_temp.assert_true((select count(*)=0 from jsonb_array_elements(public.get_profile_feed_cards()) c where c->>'id'=p::text),'removed post omitted');
 perform pg_temp.assert_true((select body like '%New private words%' from public.journal_entries where user_id=a and greg_date='2026-10-07'),'public removal keeps Journal');
 begin
   update public.journal_entries set body=jsonb_set(body::jsonb,'{blocks}',(body::jsonb->'blocks')||'[{"id":"ordinary","type":"paragraph","ops":[{"insert":"More ordinary writing"}]}]'::jsonb)::text where user_id=a and greg_date='2026-10-07';
   perform pg_temp.assert_true((select body like '%New private words%' and body like '%More ordinary writing%' and revision=7 from public.journal_entries where user_id=a and greg_date='2026-10-07'),'legacy ordinary edit preserves reflection and advances revision');
   raise exception 'rollback compatibility probe' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 begin
   insert into public.journal_entries(user_id,greg_date,body,meta)
     select user_id,greg_date,jsonb_set(body::jsonb,'{blocks}',(body::jsonb->'blocks')||'[{"id":"upsert-writing","type":"paragraph","ops":[{"insert":"Older app save"}]}]'::jsonb)::text,meta
       from public.journal_entries where user_id=a and greg_date='2026-10-07'
     on conflict(user_id,greg_date) do update set body=excluded.body,meta=excluded.meta;
   perform pg_temp.assert_true((select body like '%New private words%' and body like '%Older app save%' and revision=7 from public.journal_entries where user_id=a and greg_date='2026-10-07'),'actual legacy upsert preserves reflection and advances revision exactly once');
   raise exception 'rollback compatibility probe' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 begin
   insert into public.journal_entries(user_id,greg_date,body) values(a,'2026-10-07','stale older app document')
     on conflict(user_id,greg_date) do update set body=excluded.body;
   raise exception 'stale legacy upsert erased reflection';
 exception when serialization_failure then null; end;
 begin
   update public.journal_entries set body=(body::jsonb #- '{meta,decan_sources}')::text where user_id=a and greg_date='2026-10-07';
   raise exception 'legacy metadata loss accepted';
 exception when serialization_failure then null; end;
 begin
   update public.journal_entries set body=replace(body,'New private words','Unreviewed replacement') where user_id=a and greg_date='2026-10-07';
   raise exception 'legacy reflection edit accepted';
 exception when serialization_failure then null; end;
 begin
   delete from public.journal_entries where user_id=a and greg_date='2026-10-07';
   raise exception 'legacy delete erased reflection';
 exception when serialization_failure then null; end;
end $$;
reset role;
reset role;
savepoint account_cleanup_probe;
-- Auth-admin deletion must retain its existing cascade behavior. No Journal
-- revision or source row may block cleanup or reference the removed account.
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
delete from auth.users where id='00000000-0000-4000-8000-00000000ba01';
select pg_temp.assert_true(not exists(select 1 from public.journal_entries where user_id='00000000-0000-4000-8000-00000000ba01'),'account deletion removes Journal');
select pg_temp.assert_true(not exists(select 1 from public.journal_document_versions where user_id='00000000-0000-4000-8000-00000000ba01'),'account deletion removes revision ledger');
select pg_temp.assert_true(not exists(select 1 from public.decan_journal_sources where user_id='00000000-0000-4000-8000-00000000ba01'),'account deletion removes source records');
select pg_temp.assert_true(not exists(select 1 from public.decan_review_mutation_receipts where user_id='00000000-0000-4000-8000-00000000ba01'),'account deletion removes recovery drafts');
select pg_temp.assert_true(not exists(select 1 from public.insight_posts where user_id='00000000-0000-4000-8000-00000000ba01'),'account deletion removes public snapshots');

rollback to savepoint account_cleanup_probe;
release savepoint account_cleanup_probe;
insert into public.shared_calendars(id,owner_id,name) values ('90000000-0000-4000-8000-00000000ba01','00000000-0000-4000-8000-00000000ba01','Decan fixture');
insert into public.flows(id,user_id,calendar_id,name,rules) values (99008001,'00000000-0000-4000-8000-00000000ba01','90000000-0000-4000-8000-00000000ba01','My practice','[]');
insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,flow_local_id)
select '00000000-0000-4000-8000-00000000ba01','90000000-0000-4000-8000-00000000ba01','decan-smoke-'||n,'Recorded moment '||n,'2026-09-21 12:00Z'::timestamptz+(n%10)*interval '1 day',99008001 from generate_series(1,25) n;
insert into public.user_event_completions(user_id,client_event_id,flow_id,completed_on,source,metadata)
select '00000000-0000-4000-8000-00000000ba01', 'decan-smoke-'||n, 99008001, '2026-09-21'::date+(n%10), 'decan-smoke', jsonb_build_object('event_title','Recorded moment '||n,'flow_key','the-kar','completion_status','completed') from generate_series(1,25) n;
insert into public.journal_entries(user_id,greg_date,body) values('00000000-0000-4000-8000-00000000ba01','2026-09-22','{"version":1,"blocks":[{"id":"plain","type":"paragraph","ops":[{"insert":"A sentence I wrote."}]}],"meta":{"maat_plain_user_text_sources":{"maat:the-djed:some-source":"A sentence I wrote.","maat:the-kar:removed":"No longer in the document"}}}');
insert into public.user_library_node_progress(user_id,node_id,last_read_at,bookmarked_at) values('00000000-0000-4000-8000-00000000ba01','maat','2026-09-21 07:00Z','2026-09-22 07:00Z');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba01');
do $$
declare a uuid:='00000000-0000-4000-8000-00000000ba01'; p jsonb; second jsonb; third jsonb; source text;
begin
 p:=public.read_decan_activity_v1(a,'2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','flows');
 perform pg_temp.assert_true(jsonb_array_length(p->'items')=12,'activity page capped at 12');
 second:=public.read_decan_activity_v1(a,'2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','flows',p->>'next_cursor');
 third:=public.read_decan_activity_v1(a,'2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','flows',second->>'next_cursor');
 perform pg_temp.assert_true(jsonb_array_length(second->'items')=12 and jsonb_array_length(third->'items')=1 and third->>'next_cursor' is null,'pagination reaches every record');
 perform pg_temp.assert_true((select count(distinct value->>'id')=25 from jsonb_array_elements((p->'items')||(second->'items')||(third->'items'))),'no page duplicates');
 p:=public.read_decan_activity_v1(a,'2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','responses');
 perform pg_temp.assert_true(jsonb_array_length(p->'items')=1 and p->'items'->0->>'text'='A sentence I wrote.','only extant authored response text');
 p:=public.read_decan_activity_v1(a,'2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','journal');
 perform pg_temp.assert_true(jsonb_array_length(p->'items')=1,'deliberate Journal chooser');
 p:=public.read_decan_activity_v1(a,'2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','library');
 perform pg_temp.assert_true(jsonb_array_length(p->'items')=2,'Library read and bookmark are distinct records');
 p:=public.read_decan_activity_v1(a,'2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','previous');
 perform pg_temp.assert_true(p->'items'='[]'::jsonb,'empty previous history');
 begin perform public.read_decan_activity_v1('00000000-0000-4000-8000-00000000ba02','2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z','flows'); raise exception 'cross-account read accepted'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba02');
do $$
declare source text; p jsonb;
begin
 foreach source in array array['flows','library','responses','journal','previous'] loop
  p:=public.read_decan_activity_v1('00000000-0000-4000-8000-00000000ba02','2026-09-21','2026-09-30','2026-09-21 07:00Z','2026-10-01 07:00Z',source);
  perform pg_temp.assert_true(p->'items'='[]'::jsonb,'other account sees no '||source);
 end loop;
end $$;


rollback;
