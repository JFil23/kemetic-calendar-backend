-- Avoid PL/pgSQL name ambiguity between RETURNS TABLE output columns and
-- scheduled_notifications columns when resolving the upsert conflict target.

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
  on conflict on constraint unique_user_client_event_type
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
