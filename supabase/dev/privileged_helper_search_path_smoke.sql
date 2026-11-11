-- Disposable local fixture; all rows and temporary triggers roll back.
begin;
set local statement_timeout = '15s';
create function pg_temp.require(ok boolean, message text) returns void
language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end $$;
select pg_temp.require((select count(*) = 3 and bool_and(prosecdef and 'search_path=""' = any(proconfig))
  from pg_proc where oid in ('public.current_user_id()'::regprocedure,
    'public.fill_user_id()'::regprocedure,'public.handle_new_user()'::regprocedure)),
  'Privileged helper lookup context must be pinned');
select pg_temp.require(not exists(select 1 from pg_proc
  where oid=to_regprocedure('private.room_broadcast_trigger()')
    and (not prosecdef or not coalesce('search_path=""'=any(proconfig),false))),
  'Existing room broadcast lookup context must be pinned');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e201',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000e201","role":"authenticated"}',true);
set local search_path = pg_temp, public;
create function pg_temp.uid() returns uuid language plpgsql as $$
begin raise exception 'Untrusted caller search path was used'; end $$;
select pg_temp.require(public.current_user_id()='00000000-0000-4000-8000-00000000e201'::uuid,
  'Current user identity changed');
create temp table helper_fill_fixture(user_id uuid);
create trigger helper_fill before insert on helper_fill_fixture
  for each row execute function public.fill_user_id();
insert into helper_fill_fixture values(null),('00000000-0000-4000-8000-00000000e202');
select pg_temp.require((select count(*)=1 from helper_fill_fixture
  where user_id='00000000-0000-4000-8000-00000000e201'), 'Missing user ID was not filled');
select pg_temp.require((select count(*)=1 from helper_fill_fixture
  where user_id='00000000-0000-4000-8000-00000000e202'), 'Existing user ID changed');
insert into auth.users(id,email,aud,role)
values('00000000-0000-4000-8000-00000000e201','helper-search-path@example.test','authenticated','authenticated');
delete from public.profiles where id='00000000-0000-4000-8000-00000000e201';
create temp table helper_signup_fixture(id uuid);
create trigger helper_signup after insert on helper_signup_fixture
  for each row execute function public.handle_new_user();
insert into helper_signup_fixture values('00000000-0000-4000-8000-00000000e201');
select pg_temp.require(exists(select 1 from public.profiles where id='00000000-0000-4000-8000-00000000e201'),
  'Signup profile creation changed');
rollback;
