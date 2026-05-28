create or replace function public.flow_has_repeating_note_metadata(
  p_notes text
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_notes jsonb;
begin
  if p_notes is null or btrim(p_notes) = '' then
    return false;
  end if;

  begin
    v_notes := p_notes::jsonb;
  exception when others then
    return false;
  end;

  return jsonb_typeof(v_notes) = 'object'
    and coalesce(v_notes ->> 'kind', '') = 'repeating_note';
end;
$$;

create or replace function public.flow_record_kind(
  p_active boolean,
  p_is_hidden boolean,
  p_is_reminder boolean,
  p_notes text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_is_reminder, false) then 'reminder'
    when public.flow_has_repeating_note_metadata(p_notes) then 'hiddenHelper'
    when coalesce(p_is_hidden, false) then 'softDeleted'
    when coalesce(p_active, false) then 'active'
    else 'inactive'
  end
$$;

create or replace function public.flow_is_deleted_state(
  p_is_hidden boolean,
  p_notes text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    coalesce(p_is_hidden, false) = true
    and public.flow_has_repeating_note_metadata(p_notes) = false
$$;

create or replace function public.flow_id_from_client_event_id(
  p_client_event_id text
)
returns bigint
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_match text[];
  v_flow_id bigint;
begin
  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    return null;
  end if;

  -- Imported flow ids are authoritative. The encoded payload can still contain
  -- the sender/source flow id in its legacy |f=... segment.
  v_match := regexp_match(
    p_client_event_id,
    '^flow_import:([0-9]+):',
    'i'
  );

  if v_match is not null and array_length(v_match, 1) > 0 then
    begin
      v_flow_id := nullif(v_match[1], '')::bigint;
    exception when others then
      v_flow_id := null;
    end;

    if v_flow_id is not null and v_flow_id > 0 then
      return v_flow_id;
    end if;
  end if;

  v_match := regexp_match(
    p_client_event_id,
    '\|f=([-0-9]+)(?:\||$)',
    'i'
  );

  if v_match is null or array_length(v_match, 1) = 0 then
    return null;
  end if;

  begin
    v_flow_id := nullif(v_match[1], '')::bigint;
  exception when others then
    return null;
  end;

  if v_flow_id is null or v_flow_id <= 0 then
    return null;
  end if;

  return v_flow_id;
end;
$$;

comment on function public.flow_id_from_client_event_id(text) is
'Extracts the authoritative positive flow id from client_event_id. flow_import:<owner>:... owner ids win over legacy embedded |f= source ids.';

create or replace function public.flow_id_from_detail_metadata(
  p_detail text
)
returns bigint
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_match text[];
  v_flow_id bigint;
begin
  if p_detail is null or btrim(p_detail) = '' then
    return null;
  end if;

  v_match := regexp_match(
    p_detail,
    '(^|[;\r\n])flowLocalId=([-0-9]+)(?:[;\r\n]|$)',
    'i'
  );

  if v_match is null or array_length(v_match, 1) < 2 then
    return null;
  end if;

  begin
    v_flow_id := nullif(v_match[2], '')::bigint;
  exception when others then
    return null;
  end;

  if v_flow_id is null or v_flow_id <= 0 then
    return null;
  end if;

  return v_flow_id;
end;
$$;

create or replace function public.user_event_referenced_flow_id(
  p_flow_local_id bigint,
  p_client_event_id text,
  p_detail text
)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.flow_id_from_client_event_id(p_client_event_id),
    public.flow_id_from_detail_metadata(p_detail),
    nullif(greatest(coalesce(p_flow_local_id, 0), 0), 0)
  )
$$;

comment on function public.user_event_referenced_flow_id(bigint, text, text) is
'Canonical user_events flow resolver: authoritative client_event_id owner first, then detail metadata, then stored flow_local_id fallback.';

create or replace function public.user_event_references_flow(
  p_flow_id bigint,
  p_flow_local_id bigint,
  p_client_event_id text,
  p_detail text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    coalesce(p_flow_id, 0) > 0
    and public.user_event_referenced_flow_id(
      p_flow_local_id,
      p_client_event_id,
      p_detail
    ) = p_flow_id
$$;

create or replace function public.enforce_user_event_flow_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client_flow_id bigint;
  v_detail_flow_id bigint;
  v_flow_is_hidden boolean;
  v_flow_notes text;
begin
  if new.flow_local_id is not null and new.flow_local_id <= 0 then
    new.flow_local_id := null;
  end if;

  if lower(coalesce(new.category, '')) = 'tombstone' then
    new.flow_local_id := null;
    return new;
  end if;

  v_client_flow_id := public.flow_id_from_client_event_id(new.client_event_id);
  v_detail_flow_id := public.flow_id_from_detail_metadata(new.detail);

  new.flow_local_id := coalesce(
    v_client_flow_id,
    v_detail_flow_id,
    new.flow_local_id
  );

  if new.flow_local_id is null then
    return new;
  end if;

  select f.is_hidden, f.notes
    into v_flow_is_hidden, v_flow_notes
  from public.flows f
  where f.id = new.flow_local_id
  limit 1;

  if not found then
    raise exception 'FLOW_NOT_FOUND';
  end if;

  if public.flow_is_deleted_state(v_flow_is_hidden, v_flow_notes) then
    raise exception 'FLOW_ALREADY_DELETED';
  end if;

  return new;
end;
$$;

comment on function public.enforce_user_event_flow_integrity() is
'Canonical user_events guard. Leaves tombstones detached, normalizes embedded flow metadata into flow_local_id, prefers import/current owner ids over stale stored ids, and blocks linking events to deleted flows.';

drop trigger if exists trg_enforce_user_event_flow_integrity on public.user_events;
create trigger trg_enforce_user_event_flow_integrity
before insert or update of flow_local_id, client_event_id, detail, category
on public.user_events
for each row
execute function public.enforce_user_event_flow_integrity();

update public.user_events
   set flow_local_id = null
 where lower(coalesce(category, '')) = 'tombstone'
   and flow_local_id is not null;

update public.user_events ue
   set flow_local_id = public.user_event_referenced_flow_id(
     ue.flow_local_id,
     ue.client_event_id,
     ue.detail
   )
 where public.user_event_referenced_flow_id(
   ue.flow_local_id,
   ue.client_event_id,
   ue.detail
 ) is not null
 and lower(coalesce(ue.category, '')) <> 'tombstone'
 and ue.flow_local_id is distinct from public.user_event_referenced_flow_id(
   ue.flow_local_id,
   ue.client_event_id,
   ue.detail
 )
 and exists (
   select 1
   from public.flows f
   where f.id = public.user_event_referenced_flow_id(
     ue.flow_local_id,
     ue.client_event_id,
     ue.detail
   )
   and not public.flow_is_deleted_state(f.is_hidden, f.notes)
 );

delete from public.user_events ue
where public.user_event_referenced_flow_id(
  ue.flow_local_id,
  ue.client_event_id,
  ue.detail
) is not null
and lower(coalesce(ue.category, '')) <> 'tombstone'
and exists (
  select 1
  from public.flows f
  where f.id = public.user_event_referenced_flow_id(
    ue.flow_local_id,
    ue.client_event_id,
    ue.detail
  )
  and public.flow_is_deleted_state(f.is_hidden, f.notes)
);

delete from public.user_events ue
where public.user_event_referenced_flow_id(
  ue.flow_local_id,
  ue.client_event_id,
  ue.detail
) is not null
and lower(coalesce(ue.category, '')) <> 'tombstone'
and not exists (
  select 1
  from public.flows f
  where f.id = public.user_event_referenced_flow_id(
    ue.flow_local_id,
    ue.client_event_id,
    ue.detail
  )
);

drop view if exists public.user_events_with_calendars;

create view public.user_events_with_calendars
with (security_invoker = true) as
select
  ue.*,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.is_personal as calendar_is_personal
from public.user_events ue
join public.shared_calendars sc
  on sc.id = ue.calendar_id
where sc.deleted_at is null;

grant select on public.user_events_with_calendars to authenticated;

notify pgrst, 'reload schema';
