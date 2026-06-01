create or replace function public.event_share_flow_import_client_event_prefix(
  p_share_id uuid
)
returns text
language sql
immutable
as $$
  select 'event_share_flow:' || p_share_id::text || ':';
$$;

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
  source_row public.user_events%rowtype;
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
  source_key text;
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
      and client_event_id = target_cid;

    delete from public.user_events
    where user_id = p_share.recipient_id
      and client_event_id like target_prefix || '%';

    for source_row in
      select *
      from public.user_events
      where flow_local_id = source_flow_id
        and coalesce(category, '') <> 'tombstone'
      order by starts_at asc, created_at asc, id asc
    loop
      source_key := coalesce(
        nullif(btrim(source_row.client_event_id), ''),
        source_row.id::text
      );

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
        target_prefix || source_key,
        source_row.title,
        source_row.detail,
        source_row.location,
        coalesce(source_row.all_day, false),
        source_row.starts_at,
        source_row.ends_at,
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
    end loop;

    return;
  end if;

  delete from public.user_events
  where user_id = p_share.recipient_id
    and client_event_id like target_prefix || '%';

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

-- Re-run the calendar sync for existing accepted invites so flow-driven shares
-- backfill the full visible series instead of a single copied occurrence.
update public.event_shares
set imported_at = imported_at
where recipient_id is not null
  and deleted_at is null
  and coalesce(response_status, 'no_response') = 'accepted';
