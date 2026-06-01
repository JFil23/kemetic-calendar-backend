create or replace function public.event_share_source_flow_payload(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_event public.user_events%rowtype;
  source_flow public.flows%rowtype;
  flow_events jsonb := '[]'::jsonb;
begin
  if p_event_id is null then
    return null;
  end if;

  select *
  into source_event
  from public.user_events
  where id = p_event_id
  limit 1;

  if not found
    or source_event.flow_local_id is null
    or source_event.flow_local_id <= 0 then
    return null;
  end if;

  select *
  into source_flow
  from public.flows
  where id = source_event.flow_local_id
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_client_event_id', ue.client_event_id,
        'title', ue.title,
        'detail', ue.detail,
        'location', ue.location,
        'all_day', coalesce(ue.all_day, false),
        'starts_at', ue.starts_at,
        'ends_at', ue.ends_at,
        'category', ue.category
      )
      order by ue.starts_at asc, ue.created_at asc, ue.id asc
    ),
    '[]'::jsonb
  )
  into flow_events
  from public.user_events ue
  where ue.flow_local_id = source_flow.id
    and coalesce(ue.category, '') <> 'tombstone';

  return jsonb_build_object(
    'flow_id', source_flow.id,
    'name', source_flow.name,
    'color', source_flow.color,
    'notes', source_flow.notes,
    'rules', coalesce(source_flow.rules, '[]'::jsonb),
    'start_date', source_flow.start_date,
    'end_date', source_flow.end_date,
    'is_hidden', coalesce(source_flow.is_hidden, false),
    'is_reminder', coalesce(source_flow.is_reminder, false),
    'reminder_uuid', source_flow.reminder_uuid,
    'origin_flow_id', source_flow.origin_flow_id,
    'root_flow_id', source_flow.root_flow_id,
    'events', flow_events
  );
end;
$$;

with computed as (
  select
    es.id,
    public.event_share_source_flow_payload(es.event_id) as source_flow
  from public.event_shares es
)
update public.event_shares es
set payload_json = coalesce(es.payload_json, '{}'::jsonb) || jsonb_build_object(
  'source_flow',
  computed.source_flow
)
from computed
where es.id = computed.id
  and computed.source_flow is not null;

create or replace function public.sync_event_share_calendar_copy_from_row(
  p_share public.event_shares
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  source_event public.user_events%rowtype;
  source_flow_id bigint;
  payload jsonb := case
    when p_share.payload_json is not null
      and jsonb_typeof(p_share.payload_json) = 'object'
    then p_share.payload_json
    else '{}'::jsonb
  end;
  payload_title text;
  payload_detail text;
  payload_location text;
  payload_all_day boolean;
  payload_starts_at timestamptz;
  payload_ends_at timestamptz;
  effective_title text;
  effective_detail text;
  effective_location text;
  effective_all_day boolean;
  effective_starts_at timestamptz;
  effective_ends_at timestamptz;
  target_cid text;
  target_prefix text;
begin
  if p_share.recipient_id is null then
    return;
  end if;

  target_cid := public.event_share_import_client_event_id(p_share.id);
  target_prefix := public.event_share_flow_import_client_event_prefix(p_share.id);

  if p_share.deleted_at is not null
    or coalesce(p_share.status, 'sent') not in ('sent', 'viewed', 'imported')
    or coalesce(p_share.response_status, 'no_response') <> 'accepted' then
    delete from public.user_events
    where user_id = p_share.recipient_id
      and (
        client_event_id = target_cid
        or client_event_id like target_prefix || '%'
      );
    return;
  end if;

  if p_share.event_id is not null then
    select *
    into source_event
    from public.user_events
    where id = p_share.event_id
    limit 1;
  end if;

  source_flow_id := source_event.flow_local_id;

  if source_flow_id is not null and source_flow_id > 0 then
    delete from public.user_events
    where user_id = p_share.recipient_id
      and (
        client_event_id = target_cid
        or client_event_id like target_prefix || '%'
      );
    return;
  end if;

  payload_title := nullif(
    btrim(coalesce(payload ->> 'title', payload ->> 'name')),
    ''
  );
  payload_detail := case
    when payload ? 'detail' then nullif(payload ->> 'detail', '')
    else null
  end;
  payload_location := case
    when payload ? 'location' then nullif(payload ->> 'location', '')
    else null
  end;
  payload_all_day := case lower(coalesce(payload ->> 'all_day', ''))
    when '1' then true
    when 'true' then true
    when 't' then true
    when 'yes' then true
    when '0' then false
    when 'false' then false
    when 'f' then false
    when 'no' then false
    else null
  end;
  payload_starts_at := public.try_parse_timestamptz(payload ->> 'starts_at');
  payload_ends_at := public.try_parse_timestamptz(payload ->> 'ends_at');

  effective_title := coalesce(
    payload_title,
    nullif(btrim(source_event.title), ''),
    'Shared Event'
  );
  effective_detail := coalesce(payload_detail, source_event.detail);
  effective_location := coalesce(payload_location, source_event.location);
  effective_all_day := coalesce(payload_all_day, source_event.all_day, false);
  effective_starts_at := coalesce(payload_starts_at, source_event.starts_at);
  effective_ends_at := coalesce(payload_ends_at, source_event.ends_at);

  if effective_starts_at is null then
    raise exception
      'Accepted invite % is missing starts_at and cannot be imported',
      p_share.id
      using errcode = '22007';
  end if;

  insert into public.user_events (
    user_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    category
  )
  values (
    p_share.recipient_id,
    target_cid,
    effective_title,
    effective_detail,
    effective_location,
    effective_all_day,
    effective_starts_at,
    effective_ends_at,
    null,
    null
  )
  on conflict (user_id, client_event_id) do update
  set
    title = excluded.title,
    detail = excluded.detail,
    location = excluded.location,
    all_day = excluded.all_day,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    flow_local_id = null,
    category = null;
end;
$$;
