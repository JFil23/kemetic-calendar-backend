-- Local disposable database only; all fixtures are rolled back.
begin;

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
declare
  uid uuid := '00000000-0000-4000-8000-00000000ba01';
  rid uuid := '10000000-0000-4000-8000-00000000ba01';
  mid uuid := '20000000-0000-4000-8000-00000000ba01';
  first_result jsonb;
  result jsonb;
begin
  first_result := public.apply_planner_mutation_v1(uid,mid,'notes',rid,'{"body":"original","position":0}');
  perform pg_temp.assert_true(first_result->>'status'='applied','create applied');
  result := public.apply_planner_mutation_v1(uid,mid,'notes',rid,'{"body":"original","position":0}');
  perform pg_temp.assert_true(result=first_result,'lost acknowledgement retries exact receipt');
  perform pg_temp.assert_true((select count(*)=1 from public.alignment_notes where id=rid),'retry no duplicate');
  begin
    perform public.apply_planner_mutation_v1(uid,mid,'notes',rid,'{"body":"different"}');
    raise exception 'reused identity accepted';
  exception when invalid_parameter_value then null; end;
  -- Simulate an older client on a second device writing the original table.
  update public.alignment_notes set body='other device' where id=rid;
  result := public.apply_planner_mutation_v1(uid,'20000000-0000-4000-8000-00000000ba02','notes',rid,'{"body":"offline edit"}',1);
  perform pg_temp.assert_true(result->>'status'='conflict','concurrent edit detected');
  perform pg_temp.assert_true((select body='other device' from public.alignment_notes where id=rid),'server content preserved');
  perform pg_temp.assert_true((select request->'change'->>'body'='offline edit' from public.planner_mutation_receipts where mutation_id='20000000-0000-4000-8000-00000000ba02'),'pending version preserved in account');
  result := public.apply_planner_mutation_v1(uid,'20000000-0000-4000-8000-00000000ba03','notes',rid,'{"body":"offline edit"}',2,false,'20000000-0000-4000-8000-00000000ba02');
  perform pg_temp.assert_true(result->>'status'='applied','explicit conflict resolution applied');
  perform pg_temp.assert_true((select resolved_at is not null from public.planner_mutation_receipts where mutation_id='20000000-0000-4000-8000-00000000ba02'),'conflict resolved only after save');
  result := public.apply_planner_mutation_v1(uid,'20000000-0000-4000-8000-00000000ba04','notes',rid,'{}',3,true);
  perform pg_temp.assert_true(result->>'status'='applied','delete applied');
  result := public.apply_planner_mutation_v1(uid,'20000000-0000-4000-8000-00000000ba05','notes',rid,'{"body":"stale edit"}',3);
  perform pg_temp.assert_true(result->>'status'='conflict','stale edits cannot resurrect deletion');
  result := public.apply_planner_mutation_v1(uid,'20000000-0000-4000-8000-00000000ba06','nutrition',rid,
    '{"nutrient":"test","source":"fixture","purpose":"test","mode":"decan","decan_days":[1],"days_of_week":[],"time_h":9,"time_m":0}');
  perform pg_temp.assert_true(result->>'status'='applied','nutrition create');
  result := public.apply_planner_mutation_v1(uid,'20000000-0000-4000-8000-00000000ba07','nutrition',rid,'{"source":"updated"}',1);
  perform pg_temp.assert_true(result->'row'->>'source'='updated','nutrition edit');
  begin
    perform public.apply_planner_mutation_v1('00000000-0000-4000-8000-00000000ba02',gen_random_uuid(),'notes',gen_random_uuid(),'{"body":"wrong account"}');
    raise exception 'account fence failed';
  exception when insufficient_privilege then null; end;
end;
$$;
select public.sync_planner_nutrition_state_v1('00000000-0000-4000-8000-00000000ba01','10000000-0000-4000-8000-00000000ba01','2026-09-29','done','Completed nutrition: fixture','Fixture');
select public.sync_planner_nutrition_state_v1('00000000-0000-4000-8000-00000000ba01','10000000-0000-4000-8000-00000000ba01','2026-09-29','done','Completed nutrition: fixture','Fixture');
select pg_temp.assert_true((select count(*)=1 from public.journal_badges where event_id like 'planner-nutrition:%'),'nutrition retry has one badge');
select public.sync_planner_nutrition_state_v1('00000000-0000-4000-8000-00000000ba01','10000000-0000-4000-8000-00000000ba01','2026-09-29','pending','Nutrition: fixture','Fixture');
select pg_temp.assert_true((select count(*)=0 from public.journal_badges where event_id like 'planner-nutrition:%'),'nutrition reset persisted');
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba02');
select pg_temp.assert_true((select count(*)=0 from public.planner_mutation_receipts),'other account cannot read recovery versions');
select pg_temp.assert_true((select count(*)=0 from public.nutrition_items),'other account cannot read nutrition');
select pg_temp.assert_true(not has_function_privilege('anon','public.apply_planner_mutation_v1(uuid,uuid,text,uuid,jsonb,bigint,boolean,uuid)','execute'),'anonymous denied');
select pg_temp.assert_true(not (select prosecdef from pg_proc where oid='public.apply_planner_mutation_v1(uuid,uuid,text,uuid,jsonb,bigint,boolean,uuid)'::regprocedure),'security invoker retained');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba01');
set local role authenticated;
insert into public.planner_legacy_recovery(user_id,backup_id,kind,payload)
values(auth.uid(),'00000000-0000-0000-0000-00000000ba90','nutrition_checkmarks','{"values":["legacy checkmark"]}');
select pg_temp.assert_true((select count(*)=1 from public.planner_legacy_recovery),'owner can recover legacy backup');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000ba02');
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.planner_legacy_recovery),'other account cannot read legacy backup');
reset role;
rollback;
