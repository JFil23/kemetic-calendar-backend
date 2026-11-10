-- Disposable local database only. Fixtures and assertions roll back.
begin;
set local statement_timeout = '30s';
create function pg_temp.require(ok boolean, message text) returns void
language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',coalesce(uid::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
end $$;
create function pg_temp.assert_internal_denied() returns void language plpgsql as $$
declare name text;
begin
  foreach name in array array['flow_generation_daily_analytics','flows_color_debug',
    'inbox_share_items','maat_ledger_restoration_health'] loop
    begin
      execute format('select 1 from public.%I limit 1',name);
      raise exception 'Client role % can read internal view %',current_user,name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- Do not replace the renderers or public projections to satisfy these tests.
select pg_temp.require((select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('flow_generation_daily_analytics','flows_color_debug',
    'inbox_share_items','maat_ledger_restoration_health','profile_stats')
    and 'security_invoker=true'=any(c.reloptions)),'Every reviewed view must use caller RLS');

insert into auth.users(id,email,aud,role) select
  ('00000000-0000-4000-8000-00000000e10'||n)::uuid,
  'view-access-'||n||'@example.test','authenticated','authenticated'
from generate_series(1,5) n;
insert into public.profiles(id,email,handle,display_name,is_discoverable)
select id,email,'viewaccess'||right(id::text,1),'View access fixture',true
from auth.users where id::text like '00000000-0000-4000-8000-00000000e10%';
insert into public.staff_members(user_id,role,is_active,scopes)
values('00000000-0000-4000-8000-00000000e105','owner',true,array['product.users.read']);
insert into public.shared_calendars(id,owner_id,name)
values('10000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-00000000e101','View access fixture');
insert into public.shared_calendar_members(calendar_id,user_id,role,status) values
('10000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-00000000e101','owner','accepted'),
('10000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-00000000e102','viewer','accepted');
insert into public.flows(id,user_id,calendar_id,name,notes,rules,active)
values(99010101,'00000000-0000-4000-8000-00000000e101','10000000-0000-4000-8000-00000000e101',
  'Private live title','Private live notes','[]',true);
insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,ends_at,flow_local_id)
values('00000000-0000-4000-8000-00000000e101','10000000-0000-4000-8000-00000000e101',
 'view-access-event','Private event title',now()+interval '1 day',now()+interval '1 day 1 hour',99010101);
insert into public.flow_shares(id,flow_id,sender_id,recipient_id,channel,status,payload_json)
values('30000000-0000-4000-8000-00000000e101',99010101,
 '00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-00000000e104',
 'in_app','sent','{"name":"Shared snapshot title","notes":"Shared snapshot notes"}');
insert into public.follows(follower_id,followee_id)
values('00000000-0000-4000-8000-00000000e102','00000000-0000-4000-8000-00000000e101');

create temp table expected_profile as select to_jsonb(p) payload from public.profile_stats p
where id='00000000-0000-4000-8000-00000000e101';
grant select on expected_profile to anon,authenticated,service_role;

set local role anon;
select pg_temp.as_user(null);
select pg_temp.assert_internal_denied();
select pg_temp.require((select to_jsonb(p)=(select payload from expected_profile) from public.profile_stats p
 where id='00000000-0000-4000-8000-00000000e101'),'Anonymous public profile changed');
select pg_temp.require(not exists(select 1 from public.flows where id=99010101),'Anonymous private flow leak');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000e101');
select pg_temp.assert_internal_denied();
select pg_temp.require(exists(select 1 from public.flows where id=99010101),'Owner lost private flow');
select pg_temp.require((select to_jsonb(p)=(select payload from expected_profile) from public.profile_stats p
 where id='00000000-0000-4000-8000-00000000e101'),'Owner profile aggregates changed');

select pg_temp.as_user('00000000-0000-4000-8000-00000000e102');
select pg_temp.assert_internal_denied();
select pg_temp.require(exists(select 1 from public.flows where id=99010101),'Accepted member lost shared flow');
select pg_temp.require((select followers_count=1 from public.profile_stats
 where id='00000000-0000-4000-8000-00000000e101'),'Public follower count changed');

select pg_temp.as_user('00000000-0000-4000-8000-00000000e103');
select pg_temp.assert_internal_denied();
select pg_temp.require(not exists(select 1 from public.flows where id=99010101),'Unrelated account private flow leak');
select pg_temp.require(not exists(select 1 from public.inbox_share_items_filtered
 where share_id='30000000-0000-4000-8000-00000000e101'),'Unrelated account Inbox leak');

select pg_temp.as_user('00000000-0000-4000-8000-00000000e104');
select pg_temp.assert_internal_denied();
select pg_temp.require((select title='Shared snapshot title' and payload_json->>'notes'='Shared snapshot notes'
 from public.inbox_share_items_filtered where share_id='30000000-0000-4000-8000-00000000e101'),
 'Recipient lost canonical Inbox snapshot');

select pg_temp.as_user('00000000-0000-4000-8000-00000000e105');
select pg_temp.assert_internal_denied();
select pg_temp.require(not exists(select 1 from public.flows where id=99010101),'Staff bypassed private flow RLS');
select pg_temp.require(public.admin_activity_users(30,100,'viewaccess') is not null,'Authorized admin RPC failed');
reset role;

set local role service_role;
select count(*) from public.flow_generation_daily_analytics;
select pg_temp.require(exists(select 1 from public.flows_color_debug where id=99010101),'Service lost diagnostic read');
select count(*) from public.inbox_share_items;
select count(*) from public.maat_ledger_restoration_health;
reset role;
rollback;
