-- Local-only Cut 4 selection and mutation matrix. All fixtures roll back.
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
) values (
  '00000000-0000-4000-8000-00000000c401',
  'authenticated', 'authenticated', 'scheduled-notification-cut4@example.test',
  'not-used', now(), now(), now()
) on conflict (id) do nothing;

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
  ('00000000-0000-4000-8000-00000000c401', 'cut4-legacy-default',
   '2040-01-01 09:00:00+00', 'Legacy default', 'body', '{}', 'event_start',
   true, 0, null, null, null, null, 0, null, null, null, null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-ordinary-error',
   '2040-01-01 09:01:00+00', 'Ordinary error', 'body', '{}', 'event_start',
   true, 2, 'different_error', null, null, null, 2,
   '2040-01-01 08:00:00+00', '2040-01-01 11:00:00+00',
   '2040-01-01 09:30:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-complete-future',
   '2040-01-01 09:02:00+00', 'Complete future', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 10:01:00+00',
   '2040-01-01 12:00:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-complete-due',
   '2040-01-01 09:03:00+00', 'Complete due', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 09:59:00+00',
   '2040-01-01 12:00:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-expired-no-token',
   '2040-01-01 09:04:00+00', 'Expired no token', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 09:00:00+00',
   '2040-01-01 09:59:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-preexpiry-catchup',
   '2040-01-01 09:05:00+00', 'Pre-expiry catch-up', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 09:58:00+00',
   '2040-01-01 09:59:00+00', '2040-01-01 09:58:30+00'),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-catchup-ended',
   '2040-01-01 09:06:00+00', 'Catch-up ended', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 09:57:00+00',
   '2040-01-01 09:57:59+00', '2040-01-01 09:57:00+00'),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-postexpiry-token',
   '2040-01-01 09:07:00+00', 'Post-expiry token', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 09:59:30+00',
   '2040-01-01 09:59:00+00', '2040-01-01 09:59:30+00'),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-incomplete-count',
   '2040-01-01 09:08:00+00', 'Incomplete count', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 0,
   '2040-01-01 08:00:00+00', '2040-01-01 11:00:00+00',
   '2040-01-01 09:00:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-incomplete-first',
   '2040-01-01 09:09:00+00', 'Incomplete first', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   null, '2040-01-01 11:00:00+00', '2040-01-01 09:00:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-incomplete-next',
   '2040-01-01 09:10:00+00', 'Incomplete next', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', null, '2040-01-01 09:00:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-incomplete-expiry',
   '2040-01-01 09:11:00+00', 'Incomplete expiry', 'body', '{}', 'event_start',
   true, 2, 'no_tokens_for_recipients', null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 11:00:00+00', null, null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-incomplete-error-null',
   '2040-01-01 09:12:00+00', 'Incomplete error', 'body', '{}', 'event_start',
   true, 2, null, null, null, null, 1,
   '2040-01-01 08:00:00+00', '2040-01-01 11:00:00+00',
   '2040-01-01 09:00:00+00', null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-inactive',
   '2040-01-01 09:13:00+00', 'Inactive', 'body', '{}', 'event_start',
   false, 0, null, null, null, null, 0, null, null, null, null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-future-scheduled',
   '2040-01-01 11:00:00+00', 'Future scheduled', 'body', '{}', 'event_start',
   true, 0, null, null, null, null, 0, null, null, null, null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-lease-current',
   '2040-01-01 09:14:00+00', 'Lease current', 'body', '{}', 'event_start',
   true, 0, null, null, '2040-01-01 09:59:00+00', 'old-current-claim',
   0, null, null, null, null),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-lease-expired',
   '2040-01-01 09:15:00+00', 'Lease expired', 'body', '{}', 'event_start',
   true, 0, null, null, '2040-01-01 09:30:00+00', 'old-expired-claim',
   0, null, null, null, null);

create temporary table cut4_before as
select *
from public.scheduled_notifications
where user_id = '00000000-0000-4000-8000-00000000c401';

create temporary table cut4_claimed as
select *
from public.claim_due_scheduled_notifications(
  '2040-01-01 10:00:00+00'::timestamp with time zone,
  500,
  900
);

select pg_temp.assert_true(
  array_agg(attribute.attname::text order by attribute.attnum) = array[
    'id', 'user_id', 'client_event_id', 'title', 'body', 'payload',
    'notification_type', 'scheduled_at', 'claim_token'
  ],
  'claim RPC return column names and order must remain exact'
)
from pg_attribute attribute
where attribute.attrelid = 'cut4_claimed'::regclass
  and attribute.attnum > 0
  and not attribute.attisdropped;

select pg_temp.assert_true(
  array_agg(pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            order by attribute.attnum) = array[
    'bigint', 'uuid', 'text', 'text', 'text', 'text', 'text',
    'timestamp with time zone', 'text'
  ],
  'claim RPC return column types must remain exact'
)
from pg_attribute attribute
where attribute.attrelid = 'cut4_claimed'::regclass
  and attribute.attnum > 0
  and not attribute.attisdropped;

select pg_temp.assert_true(
  count(*) = 10
    and count(distinct claim_token) = 1
    and bool_and(claim_token is not null)
    and array_agg(client_event_id order by scheduled_at, id) = array[
      'cut4-legacy-default',
      'cut4-ordinary-error',
      'cut4-complete-due',
      'cut4-preexpiry-catchup',
      'cut4-incomplete-count',
      'cut4-incomplete-first',
      'cut4-incomplete-next',
      'cut4-incomplete-expiry',
      'cut4-incomplete-error-null',
      'cut4-lease-expired'
    ],
  'claim matrix must select exactly legacy, due, catch-up, incomplete, and lease-expired rows'
)
from cut4_claimed
where user_id = '00000000-0000-4000-8000-00000000c401';

select pg_temp.assert_true(
  count(*) = 10
    and bool_and(
      (to_jsonb(notification) - array['claimed_at', 'claim_token', 'updated_at'])
        = (to_jsonb(before_row) - array['claimed_at', 'claim_token', 'updated_at'])
    )
    and bool_and(notification.claimed_at = '2040-01-01 10:00:00+00')
    and count(distinct notification.claim_token) = 1,
  'claiming may mutate only claimed_at, claim_token, and updated_at'
)
from public.scheduled_notifications notification
join cut4_before before_row using (id)
join cut4_claimed claimed using (id)
where notification.user_id = '00000000-0000-4000-8000-00000000c401';

select pg_temp.assert_true(
  count(*) = 7 and bool_and(to_jsonb(notification) = to_jsonb(before_row)),
  'every non-claimable matrix row must remain byte-for-byte unchanged'
)
from public.scheduled_notifications notification
join cut4_before before_row using (id)
left join cut4_claimed claimed using (id)
where notification.user_id = '00000000-0000-4000-8000-00000000c401'
  and claimed.id is null;

select pg_temp.assert_true(
  count(*) = 0,
  'a second claim inside the active lease must return no fixture rows'
)
from public.claim_due_scheduled_notifications(
  '2040-01-01 10:00:00+00'::timestamp with time zone,
  500,
  900
)
where user_id = '00000000-0000-4000-8000-00000000c401';

insert into public.scheduled_notifications (
  user_id, client_event_id, scheduled_at, title, notification_type, is_active
) values
  ('00000000-0000-4000-8000-00000000c401', 'cut4-limit-first',
   '1899-01-01 00:00:00+00', 'Limit first', 'event_start', true),
  ('00000000-0000-4000-8000-00000000c401', 'cut4-limit-second',
   '1899-01-01 00:01:00+00', 'Limit second', 'event_start', true);

select pg_temp.assert_true(
  count(*) = 1 and bool_and(client_event_id = 'cut4-limit-first'),
  'p_limit = 1 must claim the earliest row only'
)
from public.claim_due_scheduled_notifications(
  '1900-01-01 00:00:00+00'::timestamp with time zone,
  1,
  900
)
where user_id = '00000000-0000-4000-8000-00000000c401';

select pg_temp.assert_true(
  count(*) = 1 and bool_and(client_event_id = 'cut4-limit-second'),
  'p_limit = 0 must retain the legacy clamp to one row'
)
from public.claim_due_scheduled_notifications(
  '1900-01-01 00:00:00+00'::timestamp with time zone,
  0,
  900
)
where user_id = '00000000-0000-4000-8000-00000000c401';

rollback;
