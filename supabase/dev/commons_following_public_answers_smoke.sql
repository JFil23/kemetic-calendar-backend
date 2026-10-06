-- Transactional local fixtures: no real accounts or content are changed.
begin;
create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('ac060000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.check_it(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;
create function pg_temp.as_user(n integer) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', pg_temp.u(n)::text, true);
 perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.u(n), 'role','authenticated')::text, true);
end; $$;
insert into auth.users(id,email) select pg_temp.u(n), 'commons-public-'||n||'@example.test' from generate_series(1,35) n;
insert into public.profiles(id,email,handle,display_name,is_discoverable)
select pg_temp.u(n), 'commons-public-'||n||'@example.test', 'commons_public_'||n, 'Commons '||n, n <> 6
from generate_series(1,35) n on conflict(id) do update set is_discoverable = excluded.is_discoverable;
insert into public.follows(follower_id, followee_id)
select pg_temp.u(1),pg_temp.u(n) from unnest(array[2,4,5,6]) n;
insert into public.user_blocks(blocker_user_id, blocked_user_id) values (pg_temp.u(1),pg_temp.u(4)),(pg_temp.u(5),pg_temp.u(1));
insert into public.shared_calendars(id, owner_id, name, is_personal)
values(pg_temp.u(100),pg_temp.u(2),'Commons public fixture',false);
insert into public.shared_practice_rooms(id,calendar_id,source_flow_id,created_by,title,visibility,request_audience)
select pg_temp.u(100+n),null,991060+n,pg_temp.u(n),'Public room '||n,'public','anyone'
from generate_series(2,6) n;
insert into public.shared_practice_room_members(room_id,user_id,role,status)
select pg_temp.u(100+n),pg_temp.u(n),'host','accepted' from generate_series(2,6) n
union all select pg_temp.u(100+n),pg_temp.u(7),'member','accepted' from generate_series(2,6) n;
insert into public.shared_practice_entries(room_id,user_id,client_event_id,completed_on,completion_status,visibility)
select pg_temp.u(102),pg_temp.u(n),'step-'||n,current_date,'observed','public' from generate_series(1,6) n;
insert into public.shared_practice_entries(room_id,user_id,client_event_id,completed_on,completion_status,visibility,moderation_status)
values
(pg_temp.u(102),pg_temp.u(2),'second',current_date,'partial','public','visible'),
(pg_temp.u(102),pg_temp.u(2),'private',current_date,'observed','private','visible'),
(pg_temp.u(102),pg_temp.u(2),'calendar',current_date,'observed','shared_with_calendar','visible'),
(pg_temp.u(102),pg_temp.u(2),'hidden',current_date,'observed','public','hidden'),
(pg_temp.u(102),pg_temp.u(2),'skipped',current_date,'skipped','public','visible'),
(pg_temp.u(102),pg_temp.u(2),'yesterday',current_date-1,'observed','public','visible');
insert into public.node_insight_entries(id,user_id,node_id,body_text)
select pg_temp.u(200+n), pg_temp.u(case when n=7 then 2 else n end), (select id from public.nodes limit 1), 'Fragment '||n
from generate_series(1,7) n;
insert into public.insight_posts(user_id,insight_entry_id,node_id,body_text,entry_date)
select user_id,id,node_id,body_text,current_date from public.node_insight_entries where id between pg_temp.u(201) and pg_temp.u(207);
insert into public.journal_entries(user_id,greg_date,body,meta)
values(pg_temp.u(2),current_date,'Private answer never shared','{}');
insert into public.commons_question_answers(id,question_id,question_text,user_id,body_text,created_at,moderation_status)
select pg_temp.u(300+n),'daily-reflection:commons-smoke','What is visible?',pg_temp.u(n),'Public answer '||n,
 '2026-10-06T12:00:00Z'::timestamptz,
 case when n=7 then 'hidden' when n=8 then 'pending_review' else 'visible' end
from generate_series(2,35) n;
set local role authenticated;
select pg_temp.as_user(1);
do $$
declare h jsonb; p jsonb; last_answer jsonb; seen uuid[] := '{}'; page_count int := 0;
begin
 h := public.get_commons_together_home_cards(current_date,'daily-reflection:commons-smoke','What is visible?',12);
 perform pg_temp.check_it(h->'rhythm' = jsonb_build_object('scope','following','active_users_today',1,'flows_kept_today',2,'public_fragments_today',2,'public_rooms_open',1), 'all four metrics must count only followed public activity; distinguish people and steps');
 perform pg_temp.check_it(jsonb_array_length(h#>'{questions,0,answers}')=12 and (h#>>'{questions,0,answers_has_more}')::boolean,'home must expose first page and continuation');
 p := public.get_commons_question_answers('daily-reflection:commons-smoke',null,null,12);
 loop
   for last_answer in select value from jsonb_array_elements(p->'answers') loop
     perform pg_temp.check_it(not (last_answer->>'id')::uuid = any(seen), 'pagination duplicates an answer');
     seen := array_append(seen,(last_answer->>'id')::uuid);
     perform pg_temp.check_it(last_answer->>'body_text' not like '%Private%', 'private answer escaped');
   end loop;
   page_count := page_count+1;
   exit when not (p->>'has_more')::boolean;
   perform pg_temp.check_it(page_count<5,'pagination did not terminate');
   p := public.get_commons_question_answers('daily-reflection:commons-smoke',(last_answer->>'created_at')::timestamptz,(last_answer->>'id')::uuid,12);
 end loop;
 perform pg_temp.check_it(cardinality(seen)=30,'every public answer, including unfollowed authors, must be reachable');
 perform pg_temp.check_it(pg_temp.u(303)=any(seen),'unfollowed public author missing');
 perform pg_temp.check_it(not pg_temp.u(304)=any(seen) and not pg_temp.u(305)=any(seen),'either block direction must hide answers');
 perform pg_temp.check_it(not pg_temp.u(307)=any(seen) and not pg_temp.u(308)=any(seen),'hidden and pending answers must stay out');
 perform pg_temp.check_it(jsonb_array_length(public.get_commons_question_answers('another-question')->'answers')=0,'answers crossed question identity');
 begin
   perform private.commons_following_rhythm(current_date);
   raise exception 'private helper directly callable';
 exception when insufficient_privilege then null; end;
end $$;
-- The existing acknowledged public writer is the only publication path.
select pg_temp.as_user(3);
select public.answer_commons_question('daily-reflection:new-smoke','What is visible?','New public answer');
select public.answer_commons_question('daily-reflection:new-smoke','What is visible?','Edited public answer');
select pg_temp.as_user(1);
select pg_temp.check_it((public.get_commons_home_cards(current_date,'daily-reflection:new-smoke','What is visible?',12)#>>'{questions,0,answers,0,body_text}')='Edited public answer','unfollowed published answer/edit must appear in Commons');
-- Follow changes affect the totals immediately, and an empty following is zero.
delete from public.follows where follower_id=pg_temp.u(1);
select pg_temp.check_it((public.get_commons_home_cards(current_date)->'rhythm') = jsonb_build_object('scope','following','active_users_today',0,'flows_kept_today',0,'public_fragments_today',0,'public_rooms_open',0),'unfollow all must zero every statistic');
insert into public.follows(follower_id,followee_id) values(pg_temp.u(1),pg_temp.u(3));
select pg_temp.check_it((public.get_commons_home_cards(current_date)#>>'{rhythm,active_users_today}')='1','following another person must update stats');
select pg_temp.as_user(3);
select public.delete_commons_answer((public.get_commons_question_answers('daily-reflection:new-smoke')#>>'{answers,0,id}')::uuid);
select pg_temp.as_user(1);
select pg_temp.check_it(jsonb_array_length(public.get_commons_question_answers('daily-reflection:new-smoke')->'answers')=0,'deleted answer remains public');
reset role;
set local role anon;
do $$ begin
 begin
   perform public.get_commons_question_answers('daily-reflection:commons-smoke');
   raise exception 'anonymous answer reader granted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
