-- Local-only smoke test for the complete Reading House invite delivery path.
-- Run after migrations against a disposable local DB. The transaction rolls
-- back after proving owner creation, recipient visibility, source identity,
-- notification creation, and Realtime publication membership.

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
  '00000000-0000-4000-8000-00000000a101',
  'authenticated',
  'authenticated',
  'reading-house-host@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000a102',
  'authenticated',
  'authenticated',
  'reading-house-reader@example.test',
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
  '00000000-0000-4000-8000-00000000a101',
  'reading-house-host@example.test',
  'househost',
  'Amina',
  true
),
(
  '00000000-0000-4000-8000-00000000a102',
  'reading-house-reader@example.test',
  'housereader',
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
  '10000000-0000-4000-8000-00000000a101',
  '00000000-0000-4000-8000-00000000a101',
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
  '10000000-0000-4000-8000-00000000a101',
  '00000000-0000-4000-8000-00000000a101',
  'owner',
  'accepted',
  '00000000-0000-4000-8000-00000000a101',
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
  calendar_id,
  notes,
  ai_metadata
) values (
  881101,
  '00000000-0000-4000-8000-00000000a101',
  'The Reading House',
  4172170,
  true,
  date '2026-09-19',
  '[]'::jsonb,
  false,
  false,
  '10000000-0000-4000-8000-00000000a101',
  'maat=the-reading-house',
  jsonb_build_object(
    'flow_key', 'the-reading-house',
    'reading_house', jsonb_build_object('book_title', 'The Odyssey')
  )
) on conflict (id) do update
  set calendar_id = excluded.calendar_id,
      notes = excluded.notes,
      ai_metadata = excluded.ai_metadata,
      active = excluded.active;

select pg_temp.as_user('00000000-0000-4000-8000-00000000a101');
set local role authenticated;

select public.invite_user_to_shared_calendar(
  '10000000-0000-4000-8000-00000000a101',
  '00000000-0000-4000-8000-00000000a102',
  'viewer',
  881101
);

select pg_temp.as_user('00000000-0000-4000-8000-00000000a102');

select pg_temp.assert_true(
  exists (
    select 1
    from public.shared_calendar_notifications notification
    where notification.calendar_id =
          '10000000-0000-4000-8000-00000000a101'
      and notification.recipient_id =
          '00000000-0000-4000-8000-00000000a102'
      and notification.kind = 'calendar_invite'
      and notification.deleted_at is null
  ),
  'Reading House invitation must create a live recipient notification'
);

select pg_temp.assert_true(
  exists (
    select 1
    from public.shared_calendar_invite_filing_items_client invite
    where invite.calendar_id =
          '10000000-0000-4000-8000-00000000a101'
      and invite.invite_direction = 'incoming'
      and invite.source_flow_id = 881101
      and invite.source_flow_key = 'the-reading-house'
      and invite.source_book_title = 'The Odyssey'
  ),
  'Invitee must receive the canonical Reading House invite identity'
);

select pg_temp.assert_true(
  (
    select count(*) = 2
    from pg_publication_tables publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename in (
        'shared_calendar_members',
        'shared_calendar_notifications'
      )
  ),
  'Both shared-calendar delivery tables must be published to Realtime'
);

rollback;
