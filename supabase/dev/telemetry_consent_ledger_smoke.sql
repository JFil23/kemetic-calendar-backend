-- Disposable local database only. All accounts, roles and events roll back.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%', message; end if; end $$;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-4000-8000-00000000ce01','authenticated','authenticated','telemetry-fixture@example.test','unused',now(),now(),now());
insert into public.profiles(id,email,handle,telemetry_enabled,is_discoverable)
values ('00000000-0000-4000-8000-00000000ce01','telemetry-fixture@example.test','telemetryfixture',false,false)
on conflict(id) do update set telemetry_enabled=false;
insert into public.app_events(user_id,event) values ('00000000-0000-4000-8000-00000000ce01','screen_view');
insert into public.user_choice_events(user_id,event_type) values ('00000000-0000-4000-8000-00000000ce01','node_opened');
select pg_temp.assert_true(not exists(select 1 from public.app_events where user_id='00000000-0000-4000-8000-00000000ce01'),'opted-out legacy app insert must not persist');
select pg_temp.assert_true(not exists(select 1 from public.user_choice_events where user_id='00000000-0000-4000-8000-00000000ce01'),'opted-out service-role choice insert must not persist');
update public.profiles set telemetry_enabled=true where id='00000000-0000-4000-8000-00000000ce01';
insert into public.app_events(user_id,event) select '00000000-0000-4000-8000-00000000ce01','qa_repeated_unknown' from generate_series(1,28);
insert into public.app_events(user_id,event) select '00000000-0000-4000-8000-00000000ce01','qa_unknown_'||g from generate_series(1,21) g;
insert into public.app_events(user_id,event) values ('00000000-0000-4000-8000-00000000ce01','screen_view');
insert into public.user_choice_events(user_id,event_type) values ('00000000-0000-4000-8000-00000000ce01','node_opened');
select pg_temp.assert_true((select count(*)=50 from public.app_events where user_id='00000000-0000-4000-8000-00000000ce01'),'enabled app pipeline');
select pg_temp.assert_true((select count(*)=1 from public.user_choice_events where user_id='00000000-0000-4000-8000-00000000ce01'),'enabled choice pipeline');
insert into public.staff_members(user_id,role,is_active,scopes) values ('00000000-0000-4000-8000-00000000ce01','owner',true,array['product.users.read']);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ce01',true);
do $$ declare result jsonb; begin
 result:=public.admin_activity_user_detail('00000000-0000-4000-8000-00000000ce01',30);
 perform pg_temp.assert_true((result#>>'{coverage,unknown_event_count}')::int=49,'coverage counts every unknown occurrence across all names');
 perform pg_temp.assert_true((result#>>'{coverage,total_app_events}')::int=50,'coverage denominator retains known rows');
 perform pg_temp.assert_true((result#>>'{coverage,unknown_event_rate}')::numeric=0.98,'unknown rate');
 perform pg_temp.assert_true((result#>>'{coverage,alert}')::boolean,'unknown threshold alert');
 perform pg_temp.assert_true(jsonb_array_length(result#>'{coverage,unmapped_events}')=20,'display only top twenty names');
 perform pg_temp.assert_true((result#>>'{coverage,unmapped_events,0,event_count}')::int=28,'grouped repeated occurrences');
end $$;
update public.profiles set telemetry_enabled=false where id='00000000-0000-4000-8000-00000000ce01';
update public.app_events set event='qa_changed_after_optout' where user_id='00000000-0000-4000-8000-00000000ce01';
select pg_temp.assert_true(not exists(select 1 from public.app_events where event='qa_changed_after_optout'),'no telemetry mutation after optout');
do $$ declare result jsonb; begin
 result:=public.admin_activity_user_detail('00000000-0000-4000-8000-00000000ce01',30);
 perform pg_temp.assert_true((result#>>'{coverage,unknown_event_count}')::int=0,'opted-out coverage zero');
 perform pg_temp.assert_true((result#>>'{coverage,unknown_event_rate}')::numeric=0,'zero denominator safe');
 perform pg_temp.assert_true(not (result#>>'{coverage,alert}')::boolean,'zero coverage no alert');
end $$;
rollback;
