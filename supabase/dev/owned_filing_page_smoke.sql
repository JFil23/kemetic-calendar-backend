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
  '00000000-0000-4000-8000-00000000b901',
  'authenticated',
  'authenticated',
  'filing-owner@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000b902',
  'authenticated',
  'authenticated',
  'filing-other@example.test',
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
  '00000000-0000-4000-8000-00000000b901',
  'filing-owner@example.test',
  'filingowner',
  'Amina',
  true
),
(
  '00000000-0000-4000-8000-00000000b902',
  'filing-other@example.test',
  'filingother',
  'Reader',
  true
) on conflict (id) do update
  set email = excluded.email,
      handle = excluded.handle,
      display_name = excluded.display_name,
      is_discoverable = excluded.is_discoverable;

insert into public.shared_calendars (
  id,
  owner_id,
  name,
  color,
  icon,
  is_personal
) values (
  '10000000-0000-4000-8000-00000000b901',
  '00000000-0000-4000-8000-00000000b901',
  'The Odyssey',
  4172170,
  'calendar',
  false
) on conflict (id) do nothing;

insert into public.shared_calendar_members (
  calendar_id,
  user_id,
  role,
  status,
  invited_by,
  responded_at
) values (
  '10000000-0000-4000-8000-00000000b901',
  '00000000-0000-4000-8000-00000000b901',
  'owner',
  'accepted',
  '00000000-0000-4000-8000-00000000b901',
  now()
) on conflict (calendar_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      invited_by = excluded.invited_by,
      responded_at = excluded.responded_at;


select pg_temp.as_user('00000000-0000-4000-8000-00000000b901');
insert into public.user_events (user_id, calendar_id, client_event_id, title, starts_at, ends_at, all_day, category)
select '00000000-0000-4000-8000-00000000b901', '10000000-0000-4000-8000-00000000b901',
  'filing-page-fixture-' || n, 'Filing page fixture',
  '2026-09-29T12:00:00Z'::timestamptz + n * interval '1 minute',
  '2026-09-29T12:30:00Z'::timestamptz + n * interval '1 minute', false,
  case when n % 3 = 0 then 'tombstone' else null end
from generate_series(1,225) n;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000b901');
do $$
declare page_offset integer; actual jsonb; expected jsonb;
begin
  foreach page_offset in array array[0,50,100,150,250] loop
    select jsonb_agg(to_jsonb(r) order by r.starts_at desc,r.id desc) into actual
      from public.get_owned_filing_page_v1('note',page_offset,50,null) r;
    select jsonb_agg(to_jsonb(r) order by r.starts_at desc,r.id desc) into expected
      from (select * from public.user_event_filing_items_client
        where user_id=auth.uid() and item_kind='note'
        order by starts_at desc,id desc limit 50 offset page_offset) r;
    perform pg_temp.assert_true(actual is not distinct from expected,
      'Filing page mismatch at offset ' || page_offset);
  end loop;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000b902');
select pg_temp.assert_true((select count(*)=0 from public.get_owned_filing_page_v1('note',0,50,null)), 'Other account received owned items');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.get_owned_filing_page_v1(text,integer,integer,timestamptz)','EXECUTE'), 'Anon can invoke owned filing reader');
select pg_temp.assert_true((select not prosecdef from pg_proc where oid='public.get_owned_filing_page_v1(text,integer,integer,timestamptz)'::regprocedure), 'Reader must preserve caller RLS');
rollback;
