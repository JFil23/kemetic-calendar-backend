create or replace function public.try_parse_date(p_value text)
returns date
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::date;
exception
  when others then
    return null;
end;
$$;

create or replace function public.try_parse_bigint(p_value text)
returns bigint
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::bigint;
exception
  when others then
    return null;
end;
$$;

create or replace function public.event_share_rewrite_reminder_notes(
  p_raw_notes text,
  p_imported_reminder_uuid uuid
)
returns text
language plpgsql
immutable
as $$
declare
  parsed jsonb;
  raw_id text;
  next_id text;
begin
  if p_imported_reminder_uuid is null then
    return p_raw_notes;
  end if;

  if p_raw_notes is null or btrim(p_raw_notes) = '' then
    return jsonb_build_object('id', p_imported_reminder_uuid::text)::text;
  end if;

  begin
    parsed := p_raw_notes::jsonb;
  exception
    when others then
      return p_raw_notes;
  end;

  if jsonb_typeof(parsed) <> 'object' then
    return p_raw_notes;
  end if;

  raw_id := nullif(btrim(parsed ->> 'id'), '');
  if raw_id is null then
    next_id := p_imported_reminder_uuid::text;
  elsif raw_id like 'nutrition:%' then
    next_id := 'nutrition:' || p_imported_reminder_uuid::text;
  elsif raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    next_id := p_imported_reminder_uuid::text;
  else
    return parsed::text;
  end if;

  return jsonb_set(parsed, '{id}', to_jsonb(next_id), true)::text;
end;
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
  imported_flow public.flows%rowtype;
  payload jsonb := case
    when p_share.payload_json is not null
      and jsonb_typeof(p_share.payload_json) = 'object'
    then p_share.payload_json
    else '{}'::jsonb
  end;
  source_flow jsonb;
  source_flow_events jsonb := '[]'::jsonb;
  source_flow_id bigint;
  source_flow_name text;
  source_flow_color bigint := 5099745;
  source_flow_notes text;
  source_flow_rules jsonb := '[]'::jsonb;
  source_flow_start_date date;
  source_flow_end_date date;
  source_flow_root_flow_id bigint;
  source_flow_is_reminder boolean := false;
  imported_flow_id bigint;
  imported_reminder_uuid uuid;
  imported_notes text;
  matched_by_share_id boolean := false;
  first_event_start timestamptz;
  last_event_start timestamptz;
  source_item jsonb;
  source_key text;
  source_title text;
  source_detail text;
  source_location text;
  source_category text;
  source_all_day boolean;
  source_starts_at timestamptz;
  source_ends_at timestamptz;
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

  if p_share.event_id is not null then
    select *
    into source_event
    from public.user_events
    where id = p_share.event_id
    limit 1;
  end if;

  source_flow := case
    when payload ? 'source_flow'
      and jsonb_typeof(payload -> 'source_flow') = 'object'
    then payload -> 'source_flow'
    else public.event_share_source_flow_payload(p_share.event_id)
  end;
  source_flow_id := public.try_parse_bigint(source_flow ->> 'flow_id');

  if p_share.deleted_at is not null
    or coalesce(p_share.status, 'sent') not in ('sent', 'viewed', 'imported')
    or coalesce(p_share.response_status, 'no_response') <> 'accepted' then
    delete from public.user_events
    where user_id = p_share.recipient_id
      and (
        client_event_id = target_cid
        or client_event_id like target_prefix || '%'
      );

    if source_flow_id is not null and source_flow_id > 0 then
      delete from public.flows
      where user_id = p_share.recipient_id
        and origin_type = 'share_import'
        and (
          origin_generation_id = p_share.id
          or (
            origin_flow_id = source_flow_id
            and origin_generation_id is null
          )
        );
    end if;
    return;
  end if;

  if source_flow is not null and source_flow_id is not null and source_flow_id > 0 then
    delete from public.user_events
    where user_id = p_share.recipient_id
      and client_event_id = target_cid;

    select *
    into imported_flow
    from public.flows
    where user_id = p_share.recipient_id
      and origin_type = 'share_import'
      and origin_generation_id = p_share.id
    order by updated_at desc
    limit 1;
    matched_by_share_id := found;

    if not found then
      select *
      into imported_flow
      from public.flows
      where user_id = p_share.recipient_id
        and origin_type = 'share_import'
        and origin_flow_id = source_flow_id
        and origin_generation_id is null
      order by updated_at desc
      limit 1;
    end if;

    if imported_flow.id is not null
      and matched_by_share_id
      and (
        coalesce(imported_flow.active, true) = false
        or coalesce(imported_flow.is_hidden, false) = true
        or (
          imported_flow.end_date is not null
          and imported_flow.end_date < current_date
        )
      ) then
      delete from public.user_events
      where user_id = p_share.recipient_id
        and (
          flow_local_id = imported_flow.id
          or client_event_id like target_prefix || '%'
        );
      return;
    end if;

    source_flow_events := case
      when jsonb_typeof(source_flow -> 'events') = 'array'
      then source_flow -> 'events'
      else '[]'::jsonb
    end;

    select
      min(public.try_parse_timestamptz(elem.value ->> 'starts_at')),
      max(public.try_parse_timestamptz(elem.value ->> 'starts_at'))
    into first_event_start, last_event_start
    from jsonb_array_elements(source_flow_events) as elem(value)
    where public.try_parse_timestamptz(elem.value ->> 'starts_at') is not null;

    source_flow_name := coalesce(
      nullif(btrim(source_flow ->> 'name'), ''),
      nullif(btrim(coalesce(payload ->> 'title', payload ->> 'name')), ''),
      nullif(btrim(source_event.title), ''),
      'Shared Flow'
    );
    source_flow_color := coalesce(
      public.try_parse_bigint(source_flow ->> 'color'),
      5099745
    ) & 16777215;
    source_flow_notes := nullif(source_flow ->> 'notes', '');
    source_flow_rules := case
      when jsonb_typeof(source_flow -> 'rules') = 'array'
      then source_flow -> 'rules'
      else '[]'::jsonb
    end;
    source_flow_start_date := coalesce(
      public.try_parse_date(source_flow ->> 'start_date'),
      (first_event_start at time zone 'utc')::date
    );
    source_flow_end_date := coalesce(
      public.try_parse_date(source_flow ->> 'end_date'),
      (last_event_start at time zone 'utc')::date
    );
    source_flow_root_flow_id := coalesce(
      public.try_parse_bigint(source_flow ->> 'root_flow_id'),
      source_flow_id
    );
    source_flow_is_reminder := case lower(coalesce(source_flow ->> 'is_reminder', ''))
      when '1' then true
      when 'true' then true
      when 't' then true
      when 'yes' then true
      else false
    end;

    if source_flow_is_reminder then
      imported_reminder_uuid := coalesce(imported_flow.reminder_uuid, gen_random_uuid());
      imported_notes := public.event_share_rewrite_reminder_notes(
        source_flow_notes,
        imported_reminder_uuid
      );
      source_flow_rules := '[]'::jsonb;
    else
      imported_reminder_uuid := null;
      imported_notes := source_flow_notes;
    end if;

    if imported_flow.id is null then
      insert into public.flows (
        user_id,
        name,
        color,
        active,
        start_date,
        end_date,
        notes,
        rules,
        is_hidden,
        is_reminder,
        reminder_uuid,
        origin_type,
        origin_flow_id,
        origin_generation_id,
        root_flow_id
      )
      values (
        p_share.recipient_id,
        source_flow_name,
        source_flow_color,
        true,
        source_flow_start_date,
        source_flow_end_date,
        imported_notes,
        source_flow_rules,
        false,
        source_flow_is_reminder,
        imported_reminder_uuid,
        'share_import',
        source_flow_id,
        p_share.id,
        source_flow_root_flow_id
      )
      returning id into imported_flow_id;
    else
      imported_flow_id := imported_flow.id;
      update public.flows
      set
        name = source_flow_name,
        color = source_flow_color,
        active = true,
        start_date = source_flow_start_date,
        end_date = source_flow_end_date,
        notes = imported_notes,
        rules = source_flow_rules,
        is_hidden = false,
        is_reminder = source_flow_is_reminder,
        reminder_uuid = imported_reminder_uuid,
        origin_type = 'share_import',
        origin_flow_id = source_flow_id,
        origin_generation_id = p_share.id,
        root_flow_id = source_flow_root_flow_id,
        updated_at = timezone('utc', now())
      where id = imported_flow_id;
    end if;

    delete from public.user_events
    where user_id = p_share.recipient_id
      and (
        flow_local_id = imported_flow_id
        or client_event_id like target_prefix || '%'
      );

    if source_flow_is_reminder then
      return;
    end if;

    for source_item in
      select value
      from jsonb_array_elements(source_flow_events)
    loop
      source_starts_at := public.try_parse_timestamptz(source_item ->> 'starts_at');
      if source_starts_at is null then
        continue;
      end if;

      source_ends_at := public.try_parse_timestamptz(source_item ->> 'ends_at');
      source_title := coalesce(
        nullif(btrim(source_item ->> 'title'), ''),
        source_flow_name
      );
      source_detail := nullif(source_item ->> 'detail', '');
      source_location := nullif(source_item ->> 'location', '');
      source_category := nullif(source_item ->> 'category', '');
      source_all_day := case lower(coalesce(source_item ->> 'all_day', ''))
        when '1' then true
        when 'true' then true
        when 't' then true
        when 'yes' then true
        else false
      end;
      source_key := coalesce(
        nullif(btrim(source_item ->> 'source_client_event_id'), ''),
        nullif(btrim(source_item ->> 'client_event_id'), ''),
        md5(
          coalesce(source_starts_at::text, '') || '|' ||
          coalesce(source_ends_at::text, '') || '|' ||
          coalesce(source_title, '') || '|' ||
          coalesce(source_location, '')
        )
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
        source_title,
        source_detail,
        source_location,
        source_all_day,
        source_starts_at,
        source_ends_at,
        imported_flow_id,
        source_category
      )
      on conflict (user_id, client_event_id) do update
      set
        title = excluded.title,
        detail = excluded.detail,
        location = excluded.location,
        all_day = excluded.all_day,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        flow_local_id = excluded.flow_local_id,
        category = excluded.category;
    end loop;

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
  and computed.source_flow is not null
  and (
    es.payload_json is null
    or jsonb_typeof(es.payload_json) <> 'object'
    or not (es.payload_json ? 'source_flow')
    or es.payload_json -> 'source_flow' is null
  );

update public.event_shares
set imported_at = imported_at
where recipient_id is not null
  and deleted_at is null
  and coalesce(response_status, 'no_response') = 'accepted';
