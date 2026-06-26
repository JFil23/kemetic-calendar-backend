-- Local-only smoke test for Commons public rhythm, shared-practice discovery,
-- join requests, question answers, and block/report privacy behavior.
-- Run after migrations against a disposable local DB:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dev/commons_home_rls_smoke.sql
-- The transaction rolls back after assertions.

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
  '00000000-0000-4000-8000-00000000c001',
  'authenticated',
  'authenticated',
  'commons-owner@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000c002',
  'authenticated',
  'authenticated',
  'commons-member@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000c003',
  'authenticated',
  'authenticated',
  'commons-requester@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000c004',
  'authenticated',
  'authenticated',
  'commons-outsider@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000c005',
  'authenticated',
  'authenticated',
  'commons-denied@example.test',
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
  '00000000-0000-4000-8000-00000000c001',
  'commons-owner@example.test',
  'commonsowner',
  'Commons Owner',
  true
),
(
  '00000000-0000-4000-8000-00000000c002',
  'commons-member@example.test',
  'commonsmember',
  'Commons Member',
  true
),
(
  '00000000-0000-4000-8000-00000000c003',
  'commons-requester@example.test',
  'commonsrequester',
  'Commons Requester',
  true
),
(
  '00000000-0000-4000-8000-00000000c004',
  'commons-outsider@example.test',
  'commonsoutsider',
  'Commons Outsider',
  true
),
(
  '00000000-0000-4000-8000-00000000c005',
  'commons-denied@example.test',
  'commonsdenied',
  'Commons Denied',
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
) values
(
  '10000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c001',
  'Commons Private Calendar',
  5099745,
  'calendar',
  false
),
(
  '10000000-0000-4000-8000-00000000c002',
  '00000000-0000-4000-8000-00000000c001',
  'Commons Public Calendar',
  5099745,
  'calendar',
  false
),
(
  '10000000-0000-4000-8000-00000000c003',
  '00000000-0000-4000-8000-00000000c001',
  'Commons Unlisted Calendar',
  5099745,
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
) values
(
  '10000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c001',
  'owner',
  'accepted',
  '00000000-0000-4000-8000-00000000c001',
  now()
),
(
  '10000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c002',
  'viewer',
  'accepted',
  '00000000-0000-4000-8000-00000000c001',
  now()
),
(
  '10000000-0000-4000-8000-00000000c002',
  '00000000-0000-4000-8000-00000000c001',
  'owner',
  'accepted',
  '00000000-0000-4000-8000-00000000c001',
  now()
),
(
  '10000000-0000-4000-8000-00000000c003',
  '00000000-0000-4000-8000-00000000c001',
  'owner',
  'accepted',
  '00000000-0000-4000-8000-00000000c001',
  now()
) on conflict (calendar_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      invited_by = excluded.invited_by,
      responded_at = excluded.responded_at;

insert into public.flows (
  id,
  user_id,
  name,
  color,
  active,
  start_date,
  rules,
  is_hidden,
  is_reminder,
  calendar_id
) values
(
  880001,
  '00000000-0000-4000-8000-00000000c001',
  'Private Smoke Flow',
  5099745,
  true,
  date '2026-06-26',
  '[]'::jsonb,
  false,
  false,
  '10000000-0000-4000-8000-00000000c001'
),
(
  880002,
  '00000000-0000-4000-8000-00000000c001',
  'Public Smoke Flow',
  5099745,
  true,
  date '2026-06-26',
  '[]'::jsonb,
  false,
  false,
  '10000000-0000-4000-8000-00000000c002'
),
(
  880003,
  '00000000-0000-4000-8000-00000000c001',
  'Unlisted Smoke Flow',
  5099745,
  true,
  date '2026-06-26',
  '[]'::jsonb,
  false,
  false,
  '10000000-0000-4000-8000-00000000c003'
) on conflict (id) do nothing;

insert into public.shared_practice_rooms (
  id,
  calendar_id,
  source_flow_id,
  shared_flow_id,
  created_by,
  title,
  flow_key,
  start_date,
  status,
  description,
  visibility,
  join_policy
) values
(
  '20000000-0000-4000-8000-00000000c001',
  '10000000-0000-4000-8000-00000000c001',
  880001,
  880001,
  '00000000-0000-4000-8000-00000000c001',
  'Private Smoke Room',
  'private-smoke',
  date '2026-06-26',
  'active',
  'Private room body must stay private.',
  'private',
  'closed'
),
(
  '20000000-0000-4000-8000-00000000c002',
  '10000000-0000-4000-8000-00000000c002',
  880002,
  880002,
  '00000000-0000-4000-8000-00000000c001',
  'Public Smoke Room',
  'public-smoke',
  date '2026-06-26',
  'active',
  'Public room can receive join requests.',
  'public',
  'owner_approval'
),
(
  '20000000-0000-4000-8000-00000000c003',
  '10000000-0000-4000-8000-00000000c003',
  880003,
  880003,
  '00000000-0000-4000-8000-00000000c001',
  'Unlisted Smoke Room',
  'unlisted-smoke',
  date '2026-06-26',
  'active',
  'Unlisted room must not appear in public discovery.',
  'unlisted',
  'closed'
) on conflict (id) do nothing;

insert into public.user_events (
  id,
  user_id,
  client_event_id,
  title,
  starts_at,
  ends_at,
  flow_local_id,
  calendar_id,
  behavior_payload
) values
(
  '30000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c001',
  'commons-private-entry',
  'Private Smoke Flow',
  timestamptz '2026-06-26 09:00:00+00',
  timestamptz '2026-06-26 09:30:00+00',
  880001,
  '10000000-0000-4000-8000-00000000c001',
  jsonb_build_object(
    'shared_practice_room_id',
    '20000000-0000-4000-8000-00000000c001'
  )
),
(
  '30000000-0000-4000-8000-00000000c002',
  '00000000-0000-4000-8000-00000000c001',
  'commons-public-private-entry',
  'Public Smoke Flow Private Entry',
  timestamptz '2026-06-26 10:00:00+00',
  timestamptz '2026-06-26 10:30:00+00',
  880002,
  '10000000-0000-4000-8000-00000000c002',
  jsonb_build_object(
    'shared_practice_room_id',
    '20000000-0000-4000-8000-00000000c002'
  )
),
(
  '30000000-0000-4000-8000-00000000c003',
  '00000000-0000-4000-8000-00000000c001',
  'commons-public-calendar-entry',
  'Public Smoke Flow Calendar Entry',
  timestamptz '2026-06-26 11:00:00+00',
  timestamptz '2026-06-26 11:30:00+00',
  880002,
  '10000000-0000-4000-8000-00000000c002',
  jsonb_build_object(
    'shared_practice_room_id',
    '20000000-0000-4000-8000-00000000c002'
  )
),
(
  '30000000-0000-4000-8000-00000000c004',
  '00000000-0000-4000-8000-00000000c001',
  'commons-public-entry',
  'Public Smoke Flow Public Entry',
  timestamptz '2026-06-26 12:00:00+00',
  timestamptz '2026-06-26 12:30:00+00',
  880002,
  '10000000-0000-4000-8000-00000000c002',
  jsonb_build_object(
    'shared_practice_room_id',
    '20000000-0000-4000-8000-00000000c002'
  )
) on conflict (id) do nothing;

insert into public.journal_entries (
  id,
  user_id,
  greg_date,
  body,
  meta,
  created_at,
  updated_at
) values (
  '40000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c001',
  date '2026-06-26',
  'SMOKE PRIVATE JOURNAL BODY MUST NOT APPEAR',
  '{}'::jsonb,
  now(),
  now()
) on conflict (id) do nothing;

set role authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c001');

select public.upsert_shared_practice_entry(
  '20000000-0000-4000-8000-00000000c001',
  'commons-private-entry',
  880001,
  date '2026-06-26',
  'observed',
  'SMOKE PRIVATE ENTRY BODY MUST NOT APPEAR',
  'private'
);

select public.upsert_shared_practice_entry(
  '20000000-0000-4000-8000-00000000c002',
  'commons-public-private-entry',
  880002,
  date '2026-06-26',
  'observed',
  'SMOKE PUBLIC ROOM PRIVATE ENTRY MUST NOT APPEAR',
  'private'
);

select public.upsert_shared_practice_entry(
  '20000000-0000-4000-8000-00000000c002',
  'commons-public-calendar-entry',
  880002,
  date '2026-06-26',
  'observed',
  'SMOKE CALENDAR-ONLY ENTRY MUST NOT APPEAR',
  'shared_with_calendar'
);

select public.upsert_shared_practice_entry(
  '20000000-0000-4000-8000-00000000c002',
  'commons-public-entry',
  880002,
  date '2026-06-26',
  'observed',
  'Public entry may appear.',
  'public'
);

select public.answer_commons_question(
  'commons-smoke-question',
  'What did practice make visible?',
  'Owner answer visible until blocked.'
);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.shared_practice_rooms
  where id = '20000000-0000-4000-8000-00000000c001';
  perform pg_temp.assert_true(
    v_count = 1,
    format('owner should see private room, got %s', v_count)
  );

  select count(*) into v_count
  from public.shared_practice_rooms
  where id = '20000000-0000-4000-8000-00000000c003';
  perform pg_temp.assert_true(
    v_count = 1,
    format('owner should see unlisted room, got %s', v_count)
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c002');

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.shared_practice_rooms
  where id = '20000000-0000-4000-8000-00000000c001';
  perform pg_temp.assert_true(
    v_count = 1,
    format('accepted member should see private room, got %s', v_count)
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c004');

do $$
declare
  v_count integer;
  v_home jsonb;
begin
  select count(*) into v_count
  from public.shared_practice_rooms
  where id = '20000000-0000-4000-8000-00000000c001';
  perform pg_temp.assert_true(
    v_count = 0,
    format('nonmember should not see private room, got %s', v_count)
  );

  select count(*) into v_count
  from public.shared_practice_rooms
  where id = '20000000-0000-4000-8000-00000000c002';
  perform pg_temp.assert_true(
    v_count = 1,
    format('authenticated nonmember should see public room, got %s', v_count)
  );

  select count(*) into v_count
  from public.shared_practice_rooms
  where id = '20000000-0000-4000-8000-00000000c003';
  perform pg_temp.assert_true(
    v_count = 0,
    format('nonmember should not see unlisted room directly, got %s', v_count)
  );

  select count(*) into v_count
  from public.shared_practice_entries
  where body_text in (
    'SMOKE PRIVATE ENTRY BODY MUST NOT APPEAR',
    'SMOKE PUBLIC ROOM PRIVATE ENTRY MUST NOT APPEAR',
    'SMOKE CALENDAR-ONLY ENTRY MUST NOT APPEAR'
  );
  perform pg_temp.assert_true(
    v_count = 0,
    format('nonmember should not read private/calendar entry bodies, got %s', v_count)
  );

  select count(*) into v_count
  from public.journal_entries
  where body = 'SMOKE PRIVATE JOURNAL BODY MUST NOT APPEAR';
  perform pg_temp.assert_true(
    v_count = 0,
    format('nonmember should not read private journal entries, got %s', v_count)
  );

  v_home := public.get_commons_home(
    date '2026-06-26',
    'commons-smoke-question',
    'What did practice make visible?',
    12
  );

  perform pg_temp.assert_true(
    exists (
      select 1
      from jsonb_array_elements(v_home -> 'public_shared_practices') as room
      where room ->> 'id' = '20000000-0000-4000-8000-00000000c002'
    ),
    'public Commons discovery should include the public room'
  );

  perform pg_temp.assert_true(
    not exists (
      select 1
      from jsonb_array_elements(v_home -> 'public_shared_practices') as room
      where room ->> 'id' = '20000000-0000-4000-8000-00000000c003'
    ),
    'public Commons discovery should not include unlisted room'
  );

  perform pg_temp.assert_true(
    (v_home #>> '{rhythm,active_users_today}')::integer = 1,
    'public rhythm should count only the one public shared-practice user'
  );

  perform pg_temp.assert_true(
    (v_home #>> '{rhythm,flows_kept_today}')::integer = 1,
    'public rhythm should count only the one public shared-practice entry'
  );

  perform pg_temp.assert_true(
    v_home #>> '{rhythm,top_flow,title}' = 'Public Smoke Flow',
    'public rhythm top flow should be based on public entries only'
  );

  perform pg_temp.assert_true(
    v_home::text not like '%SMOKE PRIVATE ENTRY BODY MUST NOT APPEAR%',
    'Commons home must not contain private entry body'
  );

  perform pg_temp.assert_true(
    v_home::text not like '%SMOKE PUBLIC ROOM PRIVATE ENTRY MUST NOT APPEAR%',
    'Commons home must not contain private entry body from public room'
  );

  perform pg_temp.assert_true(
    v_home::text not like '%SMOKE CALENDAR-ONLY ENTRY MUST NOT APPEAR%',
    'Commons home must not contain calendar-only entry body'
  );

  perform pg_temp.assert_true(
    v_home::text not like '%SMOKE PRIVATE JOURNAL BODY MUST NOT APPEAR%',
    'Commons home must not contain private journal body'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c003');

do $$
declare
  v_first jsonb;
  v_second jsonb;
  v_count integer;
  v_rows integer;
  v_request_id uuid;
begin
  v_first := public.request_join_shared_practice(
    '20000000-0000-4000-8000-00000000c002',
    'Please let me practice.'
  );
  v_second := public.request_join_shared_practice(
    '20000000-0000-4000-8000-00000000c002',
    'Still requesting.'
  );

  perform pg_temp.assert_true(
    v_first ->> 'status' = 'pending',
    'first join request should be pending'
  );
  perform pg_temp.assert_true(
    v_second ->> 'status' = 'pending',
    'duplicate join request should remain pending'
  );
  perform pg_temp.assert_true(
    v_first ->> 'id' = v_second ->> 'id',
    'duplicate pending join request should be idempotent'
  );

  select count(*) into v_count
  from public.shared_practice_join_requests
  where room_id = '20000000-0000-4000-8000-00000000c002'
    and requester_id = '00000000-0000-4000-8000-00000000c003'
    and status = 'pending';
  perform pg_temp.assert_true(
    v_count = 1,
    format('expected one pending join request, got %s', v_count)
  );

  update public.shared_practice_join_requests
     set status = 'approved',
         responded_by = '00000000-0000-4000-8000-00000000c003',
         responded_at = now()
   where room_id = '20000000-0000-4000-8000-00000000c002'
     and requester_id = '00000000-0000-4000-8000-00000000c003';
  get diagnostics v_rows = row_count;
  perform pg_temp.assert_true(
    v_rows = 0,
    format('requester direct update should affect zero rows, got %s', v_rows)
  );

  select id into v_request_id
  from public.shared_practice_join_requests
  where room_id = '20000000-0000-4000-8000-00000000c002'
    and requester_id = '00000000-0000-4000-8000-00000000c003'
    and status = 'pending'
  limit 1;

  begin
    perform public.respond_to_join_request(v_request_id, 'approved');
    raise exception 'expected non-owner join response to be rejected';
  exception
    when others then
      if sqlerrm = 'expected non-owner join response to be rejected' then
        raise;
      end if;
      if sqlerrm not like '%ROOM_NOT_MANAGEABLE%' then
        raise exception 'unexpected non-owner join response error: %', sqlerrm;
      end if;
  end;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c001');

do $$
declare
  v_request_id uuid;
  v_response jsonb;
begin
  select id into v_request_id
  from public.shared_practice_join_requests
  where room_id = '20000000-0000-4000-8000-00000000c002'
    and requester_id = '00000000-0000-4000-8000-00000000c003'
    and status = 'pending'
  limit 1;

  v_response := public.respond_to_join_request(v_request_id, 'approved');
  perform pg_temp.assert_true(
    v_response ->> 'status' = 'approved',
    'owner should approve pending join request'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c003');

do $$
declare
  v_count integer;
  v_room jsonb;
begin
  select count(*) into v_count
  from public.shared_calendar_members
  where calendar_id = '10000000-0000-4000-8000-00000000c002'
    and user_id = '00000000-0000-4000-8000-00000000c003'
    and status = 'accepted';
  perform pg_temp.assert_true(
    v_count = 1,
    format('approved requester should become accepted member, got %s', v_count)
  );

  v_room := public.get_shared_practice_room(
    '20000000-0000-4000-8000-00000000c002',
    date '2026-06-26'
  );
  perform pg_temp.assert_true(
    (v_room ->> 'viewer_is_member')::boolean = true,
    'approved requester should see joined state'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c005');

select public.request_join_shared_practice(
  '20000000-0000-4000-8000-00000000c002',
  'I may not join.'
);

select pg_temp.as_user('00000000-0000-4000-8000-00000000c001');

do $$
declare
  v_request_id uuid;
  v_response jsonb;
begin
  select id into v_request_id
  from public.shared_practice_join_requests
  where room_id = '20000000-0000-4000-8000-00000000c002'
    and requester_id = '00000000-0000-4000-8000-00000000c005'
    and status = 'pending'
  limit 1;

  v_response := public.respond_to_join_request(v_request_id, 'denied');
  perform pg_temp.assert_true(
    v_response ->> 'status' = 'denied',
    'owner should deny pending join request'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c005');

do $$
declare
  v_count integer;
  v_room jsonb;
begin
  select count(*) into v_count
  from public.shared_calendar_members
  where calendar_id = '10000000-0000-4000-8000-00000000c002'
    and user_id = '00000000-0000-4000-8000-00000000c005'
    and status = 'accepted';
  perform pg_temp.assert_true(
    v_count = 0,
    format('denied requester should not become member, got %s', v_count)
  );

  v_room := public.get_shared_practice_room(
    '20000000-0000-4000-8000-00000000c002',
    date '2026-06-26'
  );
  perform pg_temp.assert_true(
    (v_room ->> 'viewer_is_member')::boolean = false,
    'denied requester should not see joined state'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c003');

select public.answer_commons_question(
  'commons-smoke-question',
  'What did practice make visible?',
  'Requester answer before edit.'
);

select pg_temp.as_user('00000000-0000-4000-8000-00000000c001');

do $$
declare
  v_answer_id uuid;
  v_rows integer;
begin
  select id into v_answer_id
  from public.commons_question_answers
  where question_id = 'commons-smoke-question'
    and user_id = '00000000-0000-4000-8000-00000000c003'
  limit 1;

  update public.commons_question_answers
     set body_text = 'Owner should not edit requester answer.'
   where id = v_answer_id;
  get diagnostics v_rows = row_count;
  perform pg_temp.assert_true(
    v_rows = 0,
    format('non-owner answer update should affect zero rows, got %s', v_rows)
  );

  delete from public.commons_question_answers
   where id = v_answer_id;
  get diagnostics v_rows = row_count;
  perform pg_temp.assert_true(
    v_rows = 0,
    format('non-owner answer delete should affect zero rows, got %s', v_rows)
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c003');

do $$
declare
  v_answer_id uuid;
  v_count integer;
begin
  perform public.answer_commons_question(
    'commons-smoke-question',
    'What did practice make visible?',
    'Requester answer after edit.'
  );

  select id into v_answer_id
  from public.commons_question_answers
  where question_id = 'commons-smoke-question'
    and user_id = '00000000-0000-4000-8000-00000000c003'
  limit 1;

  select count(*) into v_count
  from public.commons_question_answers
  where id = v_answer_id
    and body_text = 'Requester answer after edit.';
  perform pg_temp.assert_true(
    v_count = 1,
    format('answer owner should edit own answer, got %s', v_count)
  );

  perform public.delete_commons_answer(v_answer_id);

  select count(*) into v_count
  from public.commons_question_answers
  where id = v_answer_id;
  perform pg_temp.assert_true(
    v_count = 0,
    format('answer owner should delete own answer, got %s', v_count)
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000c004');

do $$
declare
  v_owner_answer_id uuid;
  v_count integer;
  v_home jsonb;
begin
  select id into v_owner_answer_id
  from public.commons_question_answers
  where question_id = 'commons-smoke-question'
    and user_id = '00000000-0000-4000-8000-00000000c001'
  limit 1;

  insert into public.content_reports (
    reporter_user_id,
    content_type,
    content_id,
    reported_user_id,
    reason,
    details
  ) values
  (
    '00000000-0000-4000-8000-00000000c004',
    'shared_practice_room',
    '20000000-0000-4000-8000-00000000c002',
    '00000000-0000-4000-8000-00000000c001',
    'privacy_smoke',
    'Smoke report for public shared-practice room.'
  ),
  (
    '00000000-0000-4000-8000-00000000c004',
    'commons_question_answer',
    v_owner_answer_id,
    '00000000-0000-4000-8000-00000000c001',
    'privacy_smoke',
    'Smoke report for Commons answer.'
  );

  select count(*) into v_count
  from public.content_reports
  where reporter_user_id = '00000000-0000-4000-8000-00000000c004'
    and content_type in ('shared_practice_room', 'commons_question_answer');
  perform pg_temp.assert_true(
    v_count = 2,
    format('reporter should read their own reports, got %s', v_count)
  );

  insert into public.user_blocks (
    blocker_user_id,
    blocked_user_id
  ) values (
    '00000000-0000-4000-8000-00000000c004',
    '00000000-0000-4000-8000-00000000c001'
  ) on conflict (blocker_user_id, blocked_user_id) do nothing;

  v_home := public.get_commons_home(
    date '2026-06-26',
    'commons-smoke-question',
    'What did practice make visible?',
    12
  );

  perform pg_temp.assert_true(
    not exists (
      select 1
      from jsonb_array_elements(v_home -> 'public_shared_practices') as room
      where room ->> 'id' = '20000000-0000-4000-8000-00000000c002'
    ),
    'blocked owner public room should not appear in Commons discovery'
  );

  perform pg_temp.assert_true(
    not exists (
      select 1
      from jsonb_array_elements(v_home #> '{questions,0,answers}') as answer
      where answer ->> 'user_id' = '00000000-0000-4000-8000-00000000c001'
    ),
    'blocked owner answer should not appear in Commons question answers'
  );

  perform pg_temp.assert_true(
    coalesce((v_home #>> '{rhythm,active_users_today}')::integer, 0) = 0,
    'blocked owner public activity should not contribute to viewer rhythm'
  );
end;
$$;

rollback;
