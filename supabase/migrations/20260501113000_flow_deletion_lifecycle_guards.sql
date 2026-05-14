create or replace function public.flow_has_repeating_note_metadata(
  p_notes text
)
returns boolean
language plpgsql
immutable
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

comment on function public.flow_has_repeating_note_metadata(text) is
'Canonical helper-row detector. Returns true only for flow.notes payloads that decode to {"kind":"repeating_note", ...}.';

create or replace function public.flow_record_kind(
  p_active boolean,
  p_is_hidden boolean,
  p_is_reminder boolean,
  p_notes text
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_is_reminder, false) then 'reminder'
    when public.flow_has_repeating_note_metadata(p_notes) then 'hiddenHelper'
    when coalesce(p_is_hidden, false) then 'softDeleted'
    when coalesce(p_active, false) then 'active'
    else 'inactive'
  end
$$;

comment on function public.flow_record_kind(boolean, boolean, boolean, text) is
'Canonical flow classifier mirrored from the client engine: reminder, hiddenHelper, softDeleted, active, or inactive.';

create or replace function public.flow_is_deleted_state(
  p_is_hidden boolean,
  p_notes text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_is_hidden, false) = true
    and public.flow_has_repeating_note_metadata(p_notes) = false
$$;

comment on function public.flow_is_deleted_state(boolean, text) is
'Canonical backend deletion predicate for rows that should never retain or accept linked user_events. Hidden repeating-note helper rows are excluded.';

create or replace function public.flow_id_from_client_event_id(
  p_client_event_id text
)
returns bigint
language plpgsql
immutable
as $$
declare
  v_match text[];
  v_flow_id bigint;
begin
  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    return null;
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
'Extracts a positive flow id from canonical client_event_id metadata such as ...|f=42|.... Negative/manual sentinels are ignored.';

create or replace function public.flow_id_from_detail_metadata(
  p_detail text
)
returns bigint
language plpgsql
immutable
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

comment on function public.flow_id_from_detail_metadata(text) is
'Extracts a positive flowLocalId=... reference from legacy event detail metadata. Negative/manual sentinels are ignored.';

create or replace function public.user_event_referenced_flow_id(
  p_flow_local_id bigint,
  p_client_event_id text,
  p_detail text
)
returns bigint
language sql
immutable
as $$
  select case
    when coalesce(p_flow_local_id, 0) > 0 then p_flow_local_id
    when public.flow_id_from_client_event_id(p_client_event_id) is not null
      then public.flow_id_from_client_event_id(p_client_event_id)
    else public.flow_id_from_detail_metadata(p_detail)
  end
$$;

comment on function public.user_event_referenced_flow_id(bigint, text, text) is
'Canonical user_events flow resolver: explicit flow_local_id first, then embedded client_event_id metadata, then legacy detail metadata.';

create or replace function public.user_event_references_flow(
  p_flow_id bigint,
  p_flow_local_id bigint,
  p_client_event_id text,
  p_detail text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_flow_id, 0) > 0
    and (
      coalesce(p_flow_local_id, 0) = p_flow_id
      or public.flow_id_from_client_event_id(p_client_event_id) = p_flow_id
      or public.flow_id_from_detail_metadata(p_detail) = p_flow_id
    )
$$;

comment on function public.user_event_references_flow(bigint, bigint, text, text) is
'True when any user_events flow pointer (flow_local_id, client_event_id, or detail metadata) refers to the supplied flow id.';

create or replace function public.clear_flow_import_status_by_share_id(
  p_share_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_share_id is null then
    return;
  end if;

  begin
    update public.flow_shares
       set imported_at = null
     where id = p_share_id;
  exception when others then
    raise warning 'Failed to clear import status for share %: %',
      p_share_id, SQLERRM;
  end;
end;
$$;

comment on function public.clear_flow_import_status_by_share_id(uuid) is
'Resilient helper that clears flow_shares.imported_at for a soft-deleted or deleted imported flow.';

create or replace function public.clear_flow_import_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.clear_flow_import_status_by_share_id(old.share_id);
  return old;
end;
$$;

comment on function public.clear_flow_import_status() is
'Resilient trigger to clear imported_at when a flow is deleted; failures are logged, not fatal.';

create or replace function public.normalize_flow_visibility_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.flow_is_deleted_state(new.is_hidden, new.notes) then
    new.active := false;
  end if;
  return new;
end;
$$;

comment on function public.normalize_flow_visibility_state() is
'Prevents impossible hidden-active non-helper rows. Any hidden non-repeating-note flow is normalized to active=false before write.';

create or replace function public.enforce_user_event_flow_integrity()
returns trigger
language plpgsql
set search_path = public
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

  v_client_flow_id := public.flow_id_from_client_event_id(new.client_event_id);
  v_detail_flow_id := public.flow_id_from_detail_metadata(new.detail);

  if new.flow_local_id is null then
    new.flow_local_id := coalesce(v_client_flow_id, v_detail_flow_id);
  end if;

  if new.flow_local_id is null then
    return new;
  end if;

  if v_client_flow_id is not null and v_client_flow_id <> new.flow_local_id then
    raise exception 'FLOW_EVENT_REFERENCE_MISMATCH';
  end if;

  if v_detail_flow_id is not null and v_detail_flow_id <> new.flow_local_id then
    raise exception 'FLOW_EVENT_REFERENCE_MISMATCH';
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
'Canonical user_events guard. Normalizes embedded flow metadata into flow_local_id, rejects mismatched references, and blocks linking events to deleted flows.';

create or replace function public.purge_deleted_flow_events()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_was_deleted boolean;
  v_is_deleted boolean;
begin
  v_was_deleted := public.flow_is_deleted_state(old.is_hidden, old.notes);
  v_is_deleted := public.flow_is_deleted_state(new.is_hidden, new.notes);

  if not v_is_deleted then
    return new;
  end if;

  if v_was_deleted and old.share_id is not distinct from new.share_id then
    return new;
  end if;

  delete from public.user_events ue
  where public.user_event_references_flow(
    new.id,
    ue.flow_local_id,
    ue.client_event_id,
    ue.detail
  );

  perform public.clear_flow_import_status_by_share_id(new.share_id);

  return new;
end;
$$;

comment on function public.purge_deleted_flow_events() is
'Deletes every user_events row that references a flow when that flow transitions into the backend deleted state (hidden and not a repeating-note helper).';

create or replace function public.flow_is_calendar_placed(
  p_active boolean,
  p_is_hidden boolean,
  p_is_reminder boolean,
  p_notes text
)
returns boolean
language sql
immutable
as $$
  select public.flow_record_kind(
    p_active,
    p_is_hidden,
    p_is_reminder,
    p_notes
  ) = 'active'
$$;

comment on function public.flow_is_calendar_placed(boolean, boolean, boolean, text) is
'Canonical flow placement predicate for user-facing active/inactive accounting. Only rows classified as active by the shared flow engine count as calendar-placed.';

update public.flows f
   set active = false
 where public.flow_is_deleted_state(f.is_hidden, f.notes)
   and coalesce(f.active, false) = true;

update public.user_events ue
   set flow_local_id = public.user_event_referenced_flow_id(
     ue.flow_local_id,
     ue.client_event_id,
     ue.detail
   )
 where ue.flow_local_id is null
   and public.user_event_referenced_flow_id(
     ue.flow_local_id,
     ue.client_event_id,
     ue.detail
   ) is not null
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
where exists (
  select 1
  from public.flows f
  where public.flow_is_deleted_state(f.is_hidden, f.notes)
    and public.user_event_references_flow(
      f.id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail
    )
);

delete from public.user_events ue
where public.user_event_referenced_flow_id(
  ue.flow_local_id,
  ue.client_event_id,
  ue.detail
) is not null
and not exists (
  select 1
  from public.flows f
  where f.id = public.user_event_referenced_flow_id(
    ue.flow_local_id,
    ue.client_event_id,
    ue.detail
  )
);

update public.flow_shares fs
   set imported_at = null
 where exists (
   select 1
   from public.flows f
   where f.share_id = fs.id
     and public.flow_is_deleted_state(f.is_hidden, f.notes)
 );

drop trigger if exists trg_normalize_flow_visibility_state on public.flows;
create trigger trg_normalize_flow_visibility_state
before insert or update of active, is_hidden, notes
on public.flows
for each row
execute function public.normalize_flow_visibility_state();

drop trigger if exists trg_enforce_user_event_flow_integrity on public.user_events;
create trigger trg_enforce_user_event_flow_integrity
before insert or update on public.user_events
for each row
execute function public.enforce_user_event_flow_integrity();

drop trigger if exists trg_purge_deleted_flow_events on public.flows;
create trigger trg_purge_deleted_flow_events
after update of active, is_hidden, notes, share_id
on public.flows
for each row
execute function public.purge_deleted_flow_events();

notify pgrst, 'reload schema';
