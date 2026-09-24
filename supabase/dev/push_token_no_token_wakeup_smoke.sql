-- Local-only Cut 3 smoke test. Run after migrations against a disposable DB.
-- The transaction rolls back all token, notification, and claim fixtures.

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

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '00000000-0000-4000-8000-00000000c301',
    'authenticated', 'authenticated', 'scheduled-notification-cut3-a@example.test',
    'not-used', now(), now(), now()
  ),
  (
    '00000000-0000-4000-8000-00000000c302',
    'authenticated', 'authenticated', 'scheduled-notification-cut3-b@example.test',
    'not-used', now(), now(), now()
  )
on conflict (id) do nothing;

insert into public.scheduled_notifications (
  user_id,
  client_event_id,
  scheduled_at,
  title,
  body,
  payload,
  notification_type,
  is_active,
  attempt_count,
  last_error,
  last_attempt_at,
  claimed_at,
  claim_token,
  no_token_attempt_count,
  no_token_first_at,
  next_attempt_at,
  expires_at,
  token_available_at
) values
  (
    '00000000-0000-4000-8000-00000000c301', 'cut3-a-eligible',
    statement_timestamp() + interval '1 day', 'A eligible', 'body-a', '{"fixture":"a"}',
    'event_start', true, 7, 'no_tokens_for_recipients',
    statement_timestamp() - interval '5 minutes',
    statement_timestamp() - interval '10 minutes', 'cut3-original-claim-a',
    2, statement_timestamp() - interval '2 hours',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '2 hours', null
  ),
  (
    '00000000-0000-4000-8000-00000000c302', 'cut3-b-eligible',
    statement_timestamp() + interval '1 day', 'B eligible', 'body-b', '{"fixture":"b"}',
    'event_start', true, 8, 'no_tokens_for_recipients',
    statement_timestamp() - interval '6 minutes',
    statement_timestamp() - interval '11 minutes', 'cut3-original-claim-b',
    3, statement_timestamp() - interval '3 hours',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '2 hours', null
  ),
  (
    '00000000-0000-4000-8000-00000000c301', 'cut3-a-wrong-error',
    statement_timestamp() + interval '1 day', 'Wrong error', 'body', '{}',
    'event_start', true, 1, 'different_error', null, null, null,
    1, statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '2 hours', null
  ),
  (
    '00000000-0000-4000-8000-00000000c301', 'cut3-a-inactive',
    statement_timestamp() + interval '1 day', 'Inactive', 'body', '{}',
    'event_start', false, 1, 'no_tokens_for_recipients', null, null, null,
    1, statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '2 hours', null
  ),
  (
    '00000000-0000-4000-8000-00000000c301', 'cut3-a-null-expiry',
    statement_timestamp() + interval '1 day', 'Null expiry', 'body', '{}',
    'event_start', true, 1, 'no_tokens_for_recipients', null, null, null,
    1, statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '1 hour', null, null
  ),
  (
    '00000000-0000-4000-8000-00000000c301', 'cut3-a-expired',
    statement_timestamp() + interval '1 day', 'Expired', 'body', '{}',
    'event_start', true, 1, 'no_tokens_for_recipients', null, null, null,
    1, statement_timestamp() - interval '3 hours',
    statement_timestamp() - interval '2 hours',
    statement_timestamp() - interval '1 hour', null
  ),
  (
    '00000000-0000-4000-8000-00000000c301', 'cut3-a-not-entered',
    statement_timestamp() + interval '1 day', 'Not entered', 'body', '{}',
    'event_start', true, 1, 'no_tokens_for_recipients', null, null, null,
    0, null, statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '2 hours', null
  ),
  (
    '00000000-0000-4000-8000-00000000c301', 'cut3-a-no-next-at',
    statement_timestamp() + interval '1 day', 'No next attempt', 'body', '{}',
    'event_start', true, 1, 'no_tokens_for_recipients', null, null, null,
    1, statement_timestamp() - interval '1 hour', null,
    statement_timestamp() + interval '2 hours', null
  );

create temporary table cut3_before as
select *
from public.scheduled_notifications
where client_event_id like 'cut3-%';

create temporary table cut3_first_wake_window as
select clock_timestamp() as started_at;

-- Exact app path: authenticated device-id upsert with is_active = true.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000c301',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
insert into public.push_tokens (
  user_id, device_id, platform, token, is_active, last_seen_at, updated_at
) values (
  '00000000-0000-4000-8000-00000000c301',
  'cut3-device-a', 'android', 'cut3-token-a', true,
  statement_timestamp(), statement_timestamp()
)
on conflict (device_id) do update
set user_id = excluded.user_id,
    platform = excluded.platform,
    token = excluded.token,
    is_active = excluded.is_active,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
returning device_id;
reset role;

select pg_temp.assert_true(
  notification.token_available_at is not null
    and notification.next_attempt_at = notification.token_available_at
    and notification.token_available_at >= wake.started_at
    and notification.token_available_at <= clock_timestamp(),
  'user A eligible wait must be woken to the token-arrival timestamp'
)
from public.scheduled_notifications notification
cross join cut3_first_wake_window wake
where notification.client_event_id = 'cut3-a-eligible';

select pg_temp.assert_true(
  (
    to_jsonb(notification)
      - array['token_available_at', 'next_attempt_at', 'updated_at']
  ) = (
    to_jsonb(before_row)
      - array['token_available_at', 'next_attempt_at', 'updated_at']
  ),
  'wake-up must not mutate schedule, ownership, content, claim, delivery, or lifecycle state'
)
from public.scheduled_notifications notification
join cut3_before before_row using (id)
where notification.client_event_id = 'cut3-a-eligible';

select pg_temp.assert_true(
  count(*) = 7 and bool_and(to_jsonb(notification) = to_jsonb(before_row)),
  'user B and every ineligible user A wait must remain byte-for-byte unchanged'
)
from public.scheduled_notifications notification
join cut3_before before_row using (id)
where notification.client_event_id in (
  'cut3-b-eligible',
  'cut3-a-wrong-error',
  'cut3-a-inactive',
  'cut3-a-null-expiry',
  'cut3-a-expired',
  'cut3-a-not-entered',
  'cut3-a-no-next-at'
);

create temporary table cut3_after_first_wake as
select *
from public.scheduled_notifications
where client_event_id = 'cut3-a-eligible';

-- Repeating the same active upsert is registration maintenance, not arrival.
set local role authenticated;
insert into public.push_tokens (
  user_id, device_id, platform, token, is_active, last_seen_at, updated_at
) values (
  '00000000-0000-4000-8000-00000000c301',
  'cut3-device-a', 'android', 'cut3-token-a-refreshed', true,
  statement_timestamp(), statement_timestamp()
)
on conflict (device_id) do update
set user_id = excluded.user_id,
    platform = excluded.platform,
    token = excluded.token,
    is_active = excluded.is_active,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
returning device_id;
reset role;

select pg_temp.assert_true(
  to_jsonb(notification) = to_jsonb(first_wake),
  'active-to-active upsert for the same user must not duplicate the wake action'
)
from public.scheduled_notifications notification
cross join cut3_after_first_wake first_wake
where notification.client_event_id = 'cut3-a-eligible';

-- A false-to-true transition is a real token return and must wake again.
set local role authenticated;
update public.push_tokens
set is_active = false
where device_id = 'cut3-device-a';
reset role;

update public.scheduled_notifications
set token_available_at = null,
    next_attempt_at = statement_timestamp() + interval '1 hour'
where client_event_id = 'cut3-a-eligible';

create temporary table cut3_before_reactivation as
select *
from public.scheduled_notifications
where client_event_id = 'cut3-a-eligible';

set local role authenticated;
update public.push_tokens
set is_active = true
where device_id = 'cut3-device-a';
reset role;

select pg_temp.assert_true(
  notification.token_available_at is not null
    and notification.next_attempt_at = notification.token_available_at
    and (
      to_jsonb(notification)
        - array['token_available_at', 'next_attempt_at', 'updated_at']
    ) = (
      to_jsonb(before_row)
        - array['token_available_at', 'next_attempt_at', 'updated_at']
    ),
  'inactive-to-active token return must wake only the two retry timestamps'
)
from public.scheduled_notifications notification
cross join cut3_before_reactivation before_row
where notification.client_event_id = 'cut3-a-eligible';

-- Exact backend writer privilege: service-role insert succeeds and wakes only B.
create temporary table cut3_b_before_service_writer as
select *
from public.scheduled_notifications
where client_event_id = 'cut3-b-eligible';

set local role service_role;
insert into public.push_tokens (
  user_id, device_id, platform, token, is_active, last_seen_at, updated_at
) values (
  '00000000-0000-4000-8000-00000000c302',
  'cut3-device-b', 'ios', 'cut3-token-b', true,
  statement_timestamp(), statement_timestamp()
)
on conflict (device_id) do update
set user_id = excluded.user_id,
    platform = excluded.platform,
    token = excluded.token,
    is_active = excluded.is_active,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
returning device_id;
reset role;

select pg_temp.assert_true(
  notification.token_available_at is not null
    and notification.next_attempt_at = notification.token_available_at
    and (
      to_jsonb(notification)
        - array['token_available_at', 'next_attempt_at', 'updated_at']
    ) = (
      to_jsonb(before_row)
        - array['token_available_at', 'next_attempt_at', 'updated_at']
    ),
  'service-role token registration must succeed and wake only user B retry timestamps'
)
from public.scheduled_notifications notification
cross join cut3_b_before_service_writer before_row
where notification.client_event_id = 'cut3-b-eligible';

-- The accepted claim RPC continues to select and mutate its existing fields.
insert into public.scheduled_notifications (
  user_id, client_event_id, scheduled_at, title, notification_type, is_active
) values (
  '00000000-0000-4000-8000-00000000c301',
  'cut3-claim-equivalence', '1999-01-01 00:00:00+00',
  'Claim equivalence', 'event_start', true
);

create temporary table cut3_claimed as
select *
from public.claim_due_scheduled_notifications(
  '2000-01-01 00:00:00+00'::timestamp with time zone,
  500,
  900
);

select pg_temp.assert_true(
  count(*) = 1 and bool_and(claim_token is not null),
  'accepted claim RPC must retain its due-row claim behavior'
)
from cut3_claimed
where client_event_id = 'cut3-claim-equivalence';

select pg_temp.assert_true(
  claimed_at = '2000-01-01 00:00:00+00'::timestamp with time zone
    and claim_token is not null
    and no_token_attempt_count = 0
    and no_token_first_at is null
    and next_attempt_at is null
    and expires_at is null
    and token_available_at is null,
  'claim RPC must remain independent of the Cut 2 no-token lifecycle state'
)
from public.scheduled_notifications
where client_event_id = 'cut3-claim-equivalence';

select pg_temp.assert_true(
  function_row.prosecdef
    and array_to_string(function_row.proconfig, ',') like '%search_path=%'
    and not has_function_privilege('anon', function_row.oid, 'execute')
    and not has_function_privilege('authenticated', function_row.oid, 'execute')
    and not has_function_privilege('service_role', function_row.oid, 'execute'),
  'trigger helper must be SECURITY DEFINER with a fixed search_path and no API-role execute grant'
)
from pg_proc function_row
join pg_namespace function_namespace
  on function_namespace.oid = function_row.pronamespace
where function_namespace.nspname = 'private'
  and function_row.proname = 'wake_no_token_notifications_on_token_activation';

select pg_temp.assert_true(
  count(*) = 1
    and bool_and(
      pg_get_triggerdef(trigger_row.oid, true)
        ilike '%after insert or update of is_active on%push_tokens%'
    ),
  'exactly one row-level token-activation trigger must exist'
)
from pg_trigger trigger_row
where trigger_row.tgrelid = 'public.push_tokens'::regclass
  and not trigger_row.tgisinternal
  and trigger_row.tgname = 'wake_no_token_notifications_on_token_activation';

rollback;
