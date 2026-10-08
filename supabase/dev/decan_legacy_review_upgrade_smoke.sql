begin;
create or replace function pg_temp.assert_true(ok boolean, msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',msg; end if; end $$;
create or replace function pg_temp.as_user(id uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub',id::text,true); perform set_config('request.jwt.claim.role','authenticated',true); perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true); end $$;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('00000000-0000-4000-8000-00000000bc01','authenticated','authenticated','decan-upgrade-owner@example.test','not-used',now(),now(),now()),
 ('00000000-0000-4000-8000-00000000bc02','authenticated','authenticated','decan-upgrade-other@example.test','not-used',now(),now(),now());
insert into public.profiles(id,email,handle,display_name,is_discoverable) values
 ('00000000-0000-4000-8000-00000000bc01','decan-upgrade-owner@example.test','decanupgradeowner','Fixture Owner',false),
 ('00000000-0000-4000-8000-00000000bc02','decan-upgrade-other@example.test','decanupgradeother','Fixture Other',false);
insert into public.decan_reflections(id,user_id,decan_start,decan_end,decan_name,reflection_text,badge_count) values
 ('10000000-0000-4000-8000-00000000bc01','00000000-0000-4000-8000-00000000bc01','2026-09-26','2026-10-05','Older saved decan','Original generated interpretation.',177);
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000bc01');
do $$
declare
 a uuid:='00000000-0000-4000-8000-00000000bc01'; r uuid:='10000000-0000-4000-8000-00000000bc01';
 m uuid:=gen_random_uuid(); x jsonb; y jsonb;
 c jsonb:='{"schema":1,"question_id":"carry","question":"What would you like to carry forward?","moments":[]}';
begin
 begin update public.decan_reflections set review_context=c where id=r; raise exception 'unacknowledged upgrade accepted'; exception when serialization_failure then null; end;
 x:=public.apply_decan_review_v1(a,gen_random_uuid(),gen_random_uuid(),'2026-09-26','2026-10-05','Older saved decan',c,0);
 perform pg_temp.assert_true(x->>'status'='conflict','different id cannot replace an existing period');
 x:=public.apply_decan_review_v1(a,m,r,'2026-09-26','2026-10-05','Older saved decan',c,0);
 perform pg_temp.assert_true(x->>'status'='applied','older saved period upgrades through the canonical mutation');
 perform pg_temp.assert_true(x->'row'->>'id'=r::text and x->'row'->>'review_revision'='1','upgrade retains identity and acknowledges first revision');
 perform pg_temp.assert_true(x->'row'->'review_context'=c,'new authored question is the review context');
 perform pg_temp.assert_true(x->'row'->>'reflection_text'='Original generated interpretation.','earlier text retained as history');
 perform pg_temp.assert_true(x->'row'->>'badge_count'='177','earlier provenance retained');
 perform pg_temp.assert_true((select count(*)=1 from public.decan_reflections where user_id=a),'no duplicate reflection');
 perform pg_temp.assert_true((select count(*)=0 from public.decan_journal_sources where user_id=a),'conversion writes no Journal source');
 perform pg_temp.assert_true((select count(*)=0 from public.insight_posts where user_id=a),'conversion publishes no post');
 y:=public.apply_decan_review_v1(a,m,r,'2026-09-26','2026-10-05','Older saved decan',c,0);
 perform pg_temp.assert_true(y=x,'lost-ack retry returns identical receipt');
 y:=public.apply_decan_review_v1(a,gen_random_uuid(),r,'2026-09-26','2026-10-05','Older saved decan',c,0);
 perform pg_temp.assert_true(y->>'status'='conflict','concurrent stale conversion preserves first acknowledged context');
 c:=jsonb_set(c,'{question}','"What mattered that went unrecorded?"');
 y:=public.apply_decan_review_v1(a,gen_random_uuid(),r,'2026-09-26','2026-10-05','Older saved decan',c,1);
 perform pg_temp.assert_true(y->>'status'='applied' and y->'row'->>'review_revision'='2','converted period uses ordinary review updates');
 perform pg_temp.assert_true(y->'row'->>'reflection_text'='Original generated interpretation.','later context updates retain earlier text');
 begin update public.decan_reflections set review_context=c where id=r; raise exception 'direct review update accepted'; exception when serialization_failure then null; end;
 begin update public.decan_reflections set review_context=null where id=r; raise exception 'review downgraded to legacy'; exception when serialization_failure then null; end;
 x:=public.apply_decan_journal_v1(a,gen_random_uuid(),r,'2026-10-08',0,'My words from the converted reflection');
 perform pg_temp.assert_true(x->>'status'='applied','converted record uses the ordinary Journal owner');
 perform pg_temp.assert_true((select count(*)=1 from public.decan_journal_sources where user_id=a and reflection_id=r),'Journal source keeps original reflection identity');
 x:=public.apply_decan_post_v1(a,gen_random_uuid(),gen_random_uuid(),r,0,'Words explicitly chosen for sharing',true,null,'2026-10-08');
 perform pg_temp.assert_true(x->>'status'='applied','converted record can publish through the ordinary explicit post owner');
 perform pg_temp.assert_true((select count(*)=1 from public.insight_posts where user_id=a and source_reflection_id=r),'post keeps original reflection identity');
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000bc02');
select pg_temp.assert_true((select count(*)=0 from public.decan_reflections where id='10000000-0000-4000-8000-00000000bc01'),'other account cannot read the converted context');
do $$ begin
 perform public.apply_decan_review_v1('00000000-0000-4000-8000-00000000bc01',gen_random_uuid(),'10000000-0000-4000-8000-00000000bc01','2026-09-26','2026-10-05','Older saved decan','{"schema":1,"question_id":"carry","question":"Other account","moments":[]}',2);
 raise exception 'cross-account upgrade accepted'; exception when insufficient_privilege then null; end $$;
select pg_temp.assert_true(not has_function_privilege('anon','public.apply_decan_review_v1(uuid,uuid,uuid,date,date,text,jsonb,bigint)','execute'),'anonymous conversion denied');
rollback;
