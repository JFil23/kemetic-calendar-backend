-- Local fresh-database fixtures only; no accounts, roles or records survive.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%', message; end if; end $$;
select pg_temp.assert_true(public.admin_activity_app_event_label('screen_view','{"route":"/"}')='Viewed Calendar','legacy root names Calendar');
select pg_temp.assert_true(public.admin_activity_app_event_label('screen_view','{"route":"/rhythm/today"}')='Viewed today’s alignment','named route');
select pg_temp.assert_true(public.admin_activity_app_event_label('screen_view','{}')='Viewed screen (name not recorded)','missing name is honest');
select pg_temp.assert_true(public.admin_activity_app_event_label('screen_view','{"route":"/PRIVATE?token=PRIVATE"}')='Viewed screen (name not recorded)','unknown name never reflected in label');
select pg_temp.assert_true(public.admin_activity_app_event_label('screen_view','{"route":"calendar_month_detail"}')='Viewed Calendar month details','named month sheet');
select pg_temp.assert_true(public.admin_activity_app_event_label('calendar_expansion_changed','{"level":"details"}')='Showed Calendar details','Calendar zoom is not a Day View');
select pg_temp.assert_true(public.admin_activity_app_event_label('rhythm_screen_viewed','{"screen":"commitment_tracker"}')='Viewed the commitment tracker','in-place Rhythm screen');
select pg_temp.assert_true(public.admin_activity_app_event_label('node_opened','{}')='Opened Library reading','choice action label');
select pg_temp.assert_true(public.admin_activity_app_event_label('ui_tap','{"surface":"pages","target_id":"pages_journal"}')='Selected Journal from Pages','actual card tap is named without claiming successful navigation');
select pg_temp.assert_true(public.admin_activity_app_event_label('ui_tap','{"surface":"pages","target_id":"PRIVATE"}')='Selected a Pages control (target not recorded)','unknown target never reflected in label');
select pg_temp.assert_true(public.admin_activity_app_event_label('qa_unmapped','{}')='unknown_event','unknown coverage unchanged');
select pg_temp.assert_true(public.admin_activity_safe_app_event_fields('screen_view','{"route":"/","body":"PRIVATE"}')='{"route":"/","navigation_key":"/"}'::jsonb,'legacy root grouping key and privacy');
select pg_temp.assert_true(public.admin_activity_safe_app_event_fields('rhythm_screen_viewed','{"screen":"today_alignment","body":"PRIVATE","title":"PRIVATE"}')='{"navigation_key":"/rhythm/today"}'::jsonb,'static in-place key only');
select pg_temp.assert_true(public.admin_activity_safe_app_event_fields('rhythm_screen_viewed','{"screen":"PRIVATE"}')='{}'::jsonb,'unknown in-place screen never becomes a grouping key');
select pg_temp.assert_true(public.admin_activity_safe_app_event_fields('journal_autosave','{"chars":64,"body":"PRIVATE"}')='{"char_count":64}'::jsonb,'safe save metadata');
select pg_temp.assert_true(public.admin_activity_safe_app_event_fields('rhythm_item_saved','{"is_timed":false,"field_id":"PRIVATE","category":"PRIVATE"}')='{"context_label":"Untimed commitment"}'::jsonb,'commitment metadata without private identifiers');
select pg_temp.assert_true(public.admin_activity_safe_app_event_fields('rhythm_item_saved','{"is_timed":"PRIVATE"}')='{}'::jsonb,'malformed metadata is safe');
select pg_temp.assert_true(public.admin_activity_safe_app_event_fields('journal_autosave','{"chars":"9999999999999999999999999"}')='{}'::jsonb,'invalid character count is safe');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-4000-8000-00000000ce02','authenticated','authenticated','activity-label-fixture@example.test','unused',now(),now(),now());
insert into public.profiles(id,email,handle,telemetry_enabled,is_discoverable)
values ('00000000-0000-4000-8000-00000000ce02','activity-label-fixture@example.test','activitylabelfixture',true,false)
on conflict(id) do update set telemetry_enabled=true;
insert into public.app_events(user_id,event,properties,created_at) values
('00000000-0000-4000-8000-00000000ce02','screen_view','{"route":"/","body":"PRIVATE"}',now()-interval '3 minutes'),
('00000000-0000-4000-8000-00000000ce02','screen_view','{"route":"/"}',now()-interval '2 minutes'),
('00000000-0000-4000-8000-00000000ce02','ui_tap','{"surface":"pages","target_id":"pages_journal","body":"PRIVATE"}',now()-interval '1 minute');
insert into public.user_choice_events(user_id,event_type,metadata,created_at) values
('00000000-0000-4000-8000-00000000ce02','node_opened','{"body":"PRIVATE"}',now());
insert into public.staff_members(user_id,role,is_active,scopes) values
('00000000-0000-4000-8000-00000000ce02','owner',true,array['product.users.read']);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ce02',true);
do $$ declare d jsonb; u jsonb; begin
 d:=public.admin_activity_user_detail('00000000-0000-4000-8000-00000000ce02',30);
 u:=public.admin_activity_users(30,100,'activitylabelfixture');
 perform pg_temp.assert_true(jsonb_array_length(d->'timeline')=4,'no raw events dropped during presentation');
 perform pg_temp.assert_true((select count(*)=2 from jsonb_array_elements(d->'timeline') e where e->>'label'='Viewed Calendar'),'every legacy root record retained');
 perform pg_temp.assert_true(d#>>'{timeline,0,label}'='Opened Library reading','choice detail uses shared readable label');
 perform pg_temp.assert_true(u#>>'{users,0,last_event_label}'=d#>>'{timeline,0,label}','list/detail agree');
 perform pg_temp.assert_true((u#>>'{users,0,event_count}')::int=4,'list raw count preserved');
 perform pg_temp.assert_true((d#>>'{coverage,total_app_events}')::int=3,'coverage denominator preserved');
 perform pg_temp.assert_true((d#>>'{coverage,unknown_event_count}')::int=0,'known coverage preserved');
 perform pg_temp.assert_true(d::text not like '%PRIVATE%','no private payload leaked by projection');
end $$;
update public.profiles set telemetry_enabled=false where id='00000000-0000-4000-8000-00000000ce02';
do $$ declare d jsonb; u jsonb; begin
 d:=public.admin_activity_user_detail('00000000-0000-4000-8000-00000000ce02',30);
 u:=public.admin_activity_users(30,100,'activitylabelfixture');
 perform pg_temp.assert_true(jsonb_array_length(d->'timeline')=0,'opt-out still hides all activity');
 perform pg_temp.assert_true((u#>>'{users,0,event_count}')::int=0,'opt-out list count zero');
end $$;
rollback;
