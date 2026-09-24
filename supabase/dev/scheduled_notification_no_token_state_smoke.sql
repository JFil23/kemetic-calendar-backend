-- Local-only Cut 2 smoke test. Run after migrations against a disposable DB.
-- The transaction rolls back every fixture and claim mutation.

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
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000c201',
  'authenticated',
  'authenticated',
  'scheduled-notification-cut2@example.test',
  'not-used',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

-- These inserts intentionally use only the pre-Cut-2 contract.
insert into public.scheduled_notifications (
  user_id,
  client_event_id,
  scheduled_at,
  title,
  notification_type,
  is_active,
  claimed_at
) values
  (
    '00000000-0000-4000-8000-00000000c201',
    'cut2-due-unclaimed',
    '2040-01-01 09:00:00+00',
    'Cut 2 due unclaimed',
    'event_start',
    true,
    null
  ),
  (
    '00000000-0000-4000-8000-00000000c201',
    'cut2-due-lease-expired',
    '2040-01-01 09:01:00+00',
    'Cut 2 due lease expired',
    'event_start',
    true,
    '2040-01-01 09:30:00+00'
  ),
  (
    '00000000-0000-4000-8000-00000000c201',
    'cut2-due-lease-current',
    '2040-01-01 09:02:00+00',
    'Cut 2 due lease current',
    'event_start',
    true,
    '2040-01-01 09:59:00+00'
  ),
  (
    '00000000-0000-4000-8000-00000000c201',
    'cut2-future',
    '2040-01-01 11:00:00+00',
    'Cut 2 future',
    'event_start',
    true,
    null
  ),
  (
    '00000000-0000-4000-8000-00000000c201',
    'cut2-inactive',
    '2040-01-01 09:03:00+00',
    'Cut 2 inactive',
    'event_start',
    false,
    null
  );

select pg_temp.assert_true(
  count(*) = 5
    and bool_and(no_token_attempt_count = 0)
    and bool_and(no_token_first_at is null)
    and bool_and(next_attempt_at is null)
    and bool_and(expires_at is null)
    and bool_and(token_available_at is null),
  'pre-Cut-2 inserts must receive only the new neutral defaults'
)
from public.scheduled_notifications
where user_id = '00000000-0000-4000-8000-00000000c201';

do $$
begin
  begin
    update public.scheduled_notifications
       set no_token_attempt_count = -1
     where user_id = '00000000-0000-4000-8000-00000000c201'
       and client_event_id = 'cut2-future';
    raise exception 'negative no_token_attempt_count unexpectedly accepted';
  exception
    when check_violation then
      null;
  end;
end;
$$;

create temporary table cut2_claimed as
select *
from public.claim_due_scheduled_notifications(
  '2040-01-01 10:00:00+00'::timestamp with time zone,
  500,
  900
);

select pg_temp.assert_true(
  count(*) = 2
    and count(*) filter (where client_event_id = 'cut2-due-unclaimed') = 1
    and count(*) filter (where client_event_id = 'cut2-due-lease-expired') = 1
    and bool_and(claim_token is not null),
  'claim RPC must preserve its active/due/lease-expired selection contract'
)
from cut2_claimed
where user_id = '00000000-0000-4000-8000-00000000c201';

select pg_temp.assert_true(
  count(*) filter (
    where claimed_at = '2040-01-01 10:00:00+00'::timestamp with time zone
  ) = 2
    and count(*) filter (
      where client_event_id = 'cut2-due-lease-current'
        and claimed_at = '2040-01-01 09:59:00+00'::timestamp with time zone
    ) = 1
    and count(*) filter (
      where client_event_id in ('cut2-future', 'cut2-inactive')
        and claimed_at is null
    ) = 2
    and bool_and(no_token_attempt_count = 0)
    and bool_and(no_token_first_at is null)
    and bool_and(next_attempt_at is null)
    and bool_and(expires_at is null)
    and bool_and(token_available_at is null),
  'claim RPC must not consume or mutate Cut 2 lifecycle state'
)
from public.scheduled_notifications
where user_id = '00000000-0000-4000-8000-00000000c201';

select pg_temp.assert_true(
  count(*) = 3 and bool_and(i.indisvalid and i.indisready and i.indislive),
  'all pre-Cut-2 unique indexes must remain valid and ready'
)
from pg_index i
join pg_class index_relation on index_relation.oid = i.indexrelid
join pg_class table_relation on table_relation.oid = i.indrelid
join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
where table_namespace.nspname = 'public'
  and table_relation.relname = 'scheduled_notifications'
  and index_relation.relname in (
    'scheduled_notifications_pkey',
    'scheduled_notifications_notification_id_key',
    'unique_user_client_event_type'
  )
  and i.indisunique;

select pg_temp.assert_true(
  table_relation.relrowsecurity
    and not table_relation.relforcerowsecurity
    and (
      select count(*) = 4
      from pg_policy policy
      where policy.polrelid = table_relation.oid
    ),
  'scheduled_notifications RLS and policy count must remain unchanged'
)
from pg_class table_relation
join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
where table_namespace.nspname = 'public'
  and table_relation.relname = 'scheduled_notifications';

rollback;
