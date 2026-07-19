-- Local/remote-dev smoke test for group DM conversation RLS and per-user
-- member state. Run after migrations against a disposable DB:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dev/dm_conversations_rls_smoke.sql
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
  '00000000-0000-4000-8000-00000000d001',
  'authenticated',
  'authenticated',
  'dm-a@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d002',
  'authenticated',
  'authenticated',
  'dm-b@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d003',
  'authenticated',
  'authenticated',
  'dm-c@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d004',
  'authenticated',
  'authenticated',
  'dm-outsider@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d005',
  'authenticated',
  'authenticated',
  'dm-left@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d006',
  'authenticated',
  'authenticated',
  'dm-deleted-member@example.test',
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
  is_discoverable,
  allow_incoming_shares
) values
(
  '00000000-0000-4000-8000-00000000d001',
  'dm-a@example.test',
  'dma',
  'DM A',
  true,
  true
),
(
  '00000000-0000-4000-8000-00000000d002',
  'dm-b@example.test',
  'dmb',
  'DM B',
  true,
  true
),
(
  '00000000-0000-4000-8000-00000000d003',
  'dm-c@example.test',
  'dmc',
  'DM C',
  true,
  true
),
(
  '00000000-0000-4000-8000-00000000d004',
  'dm-outsider@example.test',
  'dmoutsider',
  'DM Outsider',
  true,
  true
),
(
  '00000000-0000-4000-8000-00000000d005',
  'dm-left@example.test',
  'dmleft',
  'DM Left',
  true,
  true
),
(
  '00000000-0000-4000-8000-00000000d006',
  'dm-deleted-member@example.test',
  'dmdeletedmember',
  'DM Deleted Member',
  true,
  true
) on conflict (id) do update
  set email = excluded.email,
      handle = excluded.handle,
      display_name = excluded.display_name,
      is_discoverable = excluded.is_discoverable,
      allow_incoming_shares = excluded.allow_incoming_shares;

insert into public.dm_conversations (
  id,
  type,
  title,
  created_by,
  created_at,
  updated_at,
  last_message_at
) values (
  '10000000-0000-4000-8000-00000000d001',
  'group',
  null,
  '00000000-0000-4000-8000-00000000d001',
  '2026-06-29T12:00:00Z',
  '2026-06-29T12:01:00Z',
  '2026-06-29T12:01:00Z'
) on conflict (id) do update
  set type = excluded.type,
      title = excluded.title,
      created_by = excluded.created_by,
      updated_at = excluded.updated_at,
      last_message_at = excluded.last_message_at,
      deleted_at = null;

insert into public.dm_conversation_members (
  conversation_id,
  user_id,
  role,
  joined_at,
  archived_at,
  last_read_at,
  left_at,
  deleted_at
) values
(
  '10000000-0000-4000-8000-00000000d001',
  '00000000-0000-4000-8000-00000000d001',
  'owner',
  '2026-06-29T12:00:00Z',
  null,
  '2026-06-29T12:01:00Z',
  null,
  null
),
(
  '10000000-0000-4000-8000-00000000d001',
  '00000000-0000-4000-8000-00000000d002',
  'member',
  '2026-06-29T12:00:00Z',
  '2026-06-29T12:02:00Z',
  null,
  null,
  null
),
(
  '10000000-0000-4000-8000-00000000d001',
  '00000000-0000-4000-8000-00000000d003',
  'member',
  '2026-06-29T12:00:00Z',
  null,
  null,
  null,
  null
),
(
  '10000000-0000-4000-8000-00000000d001',
  '00000000-0000-4000-8000-00000000d005',
  'member',
  '2026-06-29T12:00:00Z',
  null,
  null,
  '2026-06-29T12:02:00Z',
  null
),
(
  '10000000-0000-4000-8000-00000000d001',
  '00000000-0000-4000-8000-00000000d006',
  'member',
  '2026-06-29T12:00:00Z',
  null,
  null,
  null,
  '2026-06-29T12:03:00Z'
) on conflict (conversation_id, user_id) do update
  set role = excluded.role,
      joined_at = excluded.joined_at,
      archived_at = excluded.archived_at,
      last_read_at = excluded.last_read_at,
      left_at = excluded.left_at,
      deleted_at = excluded.deleted_at;

insert into public.dm_messages (
  id,
  conversation_id,
  sender_id,
  body,
  kind,
  created_at
) values (
  '20000000-0000-4000-8000-00000000d001',
  '10000000-0000-4000-8000-00000000d001',
  '00000000-0000-4000-8000-00000000d001',
  'private group smoke message',
  'text',
  '2026-06-29T12:01:00Z'
) on conflict (id) do update
  set conversation_id = excluded.conversation_id,
      sender_id = excluded.sender_id,
      body = excluded.body,
      kind = excluded.kind,
      created_at = excluded.created_at,
      deleted_at = null;

insert into public.dm_message_reactions (
  message_id,
  user_id,
  reaction,
  created_at
) values (
  '20000000-0000-4000-8000-00000000d001',
  '00000000-0000-4000-8000-00000000d002',
  'heart',
  '2026-06-29T12:02:00Z'
) on conflict (message_id, user_id, reaction) do nothing;

set role authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-00000000d001');

do $$
declare
  v_member_count integer;
begin
  select count(*) into v_member_count
  from public.dm_conversation_summaries
  where conversation_id = '10000000-0000-4000-8000-00000000d001';
  perform pg_temp.assert_true(v_member_count = 1, 'member A must list group');

  select jsonb_array_length(members) into v_member_count
  from public.dm_conversation_summaries
  where conversation_id = '10000000-0000-4000-8000-00000000d001';
  perform pg_temp.assert_true(
    v_member_count = 3,
    'summary members must exclude left/deleted members only'
  );

  perform pg_temp.assert_true(
    exists (
      select 1
      from public.dm_conversation_summaries
      where conversation_id = '10000000-0000-4000-8000-00000000d001'
        and archived_at is null
    ),
    'member A archive state must remain independent'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_messages
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 1,
    'member A must read messages'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_message_reactions
     where message_id = '20000000-0000-4000-8000-00000000d001') = 1,
    'member A must read reactions'
  );

  perform pg_temp.assert_true(
    public.dm_is_conversation_member(
      '10000000-0000-4000-8000-00000000d001'
    ),
    'member A helper must return true'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000d002');

do $$
begin
  perform pg_temp.assert_true(
    exists (
      select 1
      from public.dm_conversation_summaries
      where conversation_id = '10000000-0000-4000-8000-00000000d001'
        and archived_at is not null
    ),
    'member B must see only their own archived state'
  );

  perform pg_temp.assert_true(
    (select unread_count from public.dm_conversation_summaries
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 1,
    'member B unread count must be per-user'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000d004');

do $$
declare
  v_allowed boolean := true;
begin
  perform pg_temp.assert_true(
    not public.dm_is_conversation_member(
      '10000000-0000-4000-8000-00000000d001'
    ),
    'outsider helper must return false'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_conversations
     where id = '10000000-0000-4000-8000-00000000d001') = 0,
    'outsider must not list conversations'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_conversation_members
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 0,
    'outsider must not list member rows'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_conversation_summaries
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 0,
    'outsider must not list summaries'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_messages
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 0,
    'outsider must not read messages'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_message_reactions
     where message_id = '20000000-0000-4000-8000-00000000d001') = 0,
    'outsider must not read reactions'
  );

  begin
    insert into public.dm_messages (
      conversation_id,
      sender_id,
      body,
      kind
    ) values (
      '10000000-0000-4000-8000-00000000d001',
      '00000000-0000-4000-8000-00000000d004',
      'forbidden outsider write',
      'text'
    );
  exception when others then
    v_allowed := false;
  end;
  perform pg_temp.assert_true(
    v_allowed is false,
    'outsider direct message insert must be denied'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000d005');

do $$
begin
  perform pg_temp.assert_true(
    not public.dm_is_conversation_member(
      '10000000-0000-4000-8000-00000000d001'
    ),
    'left member helper must return false'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_conversation_summaries
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 0,
    'left member must not list summaries'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_messages
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 0,
    'left member must not read messages'
  );
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000d006');

do $$
begin
  perform pg_temp.assert_true(
    not public.dm_is_conversation_member(
      '10000000-0000-4000-8000-00000000d001'
    ),
    'deleted member helper must return false'
  );

  perform pg_temp.assert_true(
    (select count(*) from public.dm_conversation_summaries
     where conversation_id = '10000000-0000-4000-8000-00000000d001') = 0,
    'deleted member must not list summaries'
  );
end;
$$;

rollback;
