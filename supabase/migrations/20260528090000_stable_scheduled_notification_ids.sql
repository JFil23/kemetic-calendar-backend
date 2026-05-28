-- Assign platform notification ids from the database instead of client hashes.
-- Logical identity remains (user_id, client_event_id, notification_type).

create sequence if not exists public.scheduled_notifications_notification_id_seq
  as integer
  increment by 1
  minvalue 1
  maxvalue 2147483647
  start with 1000001
  no cycle;

comment on sequence public.scheduled_notifications_notification_id_seq is
'Allocates stable positive platform notification ids for scheduled_notifications.';

do $$
declare
  v_max_existing integer;
begin
  select coalesce(max(notification_id), 0)
    into v_max_existing
  from public.scheduled_notifications
  where notification_id > 0;

  if v_max_existing >= 2147483647 then
    raise exception 'scheduled_notifications.notification_id is outside the supported platform integer range';
  end if;

  perform setval(
    'public.scheduled_notifications_notification_id_seq',
    greatest(v_max_existing, 1000000),
    true
  );
end $$;

with ranked as (
  select
    id,
    notification_id,
    row_number() over (
      partition by notification_id
      order by is_active desc, updated_at desc, id desc
    ) as notification_id_rank
  from public.scheduled_notifications
),
to_reassign as (
  select id
  from ranked
  where notification_id <= 0
     or notification_id_rank > 1
)
update public.scheduled_notifications sn
   set notification_id = nextval(
         'public.scheduled_notifications_notification_id_seq'
       )::integer,
       updated_at = now()
  from to_reassign r
 where sn.id = r.id;

alter table public.scheduled_notifications
  alter column notification_id set default nextval(
    'public.scheduled_notifications_notification_id_seq'
  )::integer;

alter table public.scheduled_notifications
  drop constraint if exists scheduled_notifications_notification_id_positive;

alter table public.scheduled_notifications
  add constraint scheduled_notifications_notification_id_positive
  check (notification_id > 0);

create unique index if not exists scheduled_notifications_notification_id_key
  on public.scheduled_notifications (notification_id);

grant usage, select
  on sequence public.scheduled_notifications_notification_id_seq
  to authenticated, service_role;

create or replace function public.upsert_scheduled_notification(
  p_client_event_id text,
  p_scheduled_at timestamp with time zone,
  p_title text,
  p_body text default null,
  p_payload text default '{}',
  p_notification_type text default 'event_start'
)
returns table(
  id bigint,
  user_id uuid,
  client_event_id text,
  notification_id integer,
  scheduled_at timestamp with time zone,
  title text,
  body text,
  payload text,
  is_active boolean,
  notification_type text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_event_id text := nullif(btrim(p_client_event_id), '');
  v_title text := nullif(btrim(p_title), '');
  v_notification_type text :=
    coalesce(nullif(btrim(p_notification_type), ''), 'event_start');
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_client_event_id is null then
    raise exception 'CLIENT_EVENT_ID_REQUIRED';
  end if;

  if p_scheduled_at is null then
    raise exception 'SCHEDULED_AT_REQUIRED';
  end if;

  if v_title is null then
    raise exception 'TITLE_REQUIRED';
  end if;

  return query
  insert into public.scheduled_notifications as sn (
    user_id,
    client_event_id,
    scheduled_at,
    title,
    body,
    payload,
    is_active,
    notification_type,
    attempt_count,
    last_error,
    last_attempt_at,
    claimed_at,
    claim_token
  )
  values (
    v_user_id,
    v_client_event_id,
    p_scheduled_at,
    v_title,
    p_body,
    coalesce(p_payload, '{}'),
    true,
    v_notification_type,
    0,
    null,
    null,
    null,
    null
  )
  on conflict (user_id, client_event_id, notification_type)
  do update set
    scheduled_at = excluded.scheduled_at,
    title = excluded.title,
    body = excluded.body,
    payload = excluded.payload,
    is_active = true,
    attempt_count = 0,
    last_error = null,
    last_attempt_at = null,
    claimed_at = null,
    claim_token = null,
    updated_at = now()
  returning
    sn.id,
    sn.user_id,
    sn.client_event_id,
    sn.notification_id,
    sn.scheduled_at,
    sn.title,
    sn.body,
    sn.payload,
    sn.is_active,
    sn.notification_type;
end;
$$;

comment on function public.upsert_scheduled_notification(
  text,
  timestamp with time zone,
  text,
  text,
  text,
  text
) is
'Upserts scheduled_notifications by logical identity while preserving the stored platform notification_id on conflict.';

revoke all on function public.upsert_scheduled_notification(
  text,
  timestamp with time zone,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.upsert_scheduled_notification(
  text,
  timestamp with time zone,
  text,
  text,
  text,
  text
) to authenticated;
