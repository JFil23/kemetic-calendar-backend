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
    when public.flow_has_repeating_note_metadata(p_notes)
      and coalesce(p_active, false) then 'hiddenHelper'
    when coalesce(p_is_hidden, false) then 'softDeleted'
    when coalesce(p_active, false) then 'active'
    else 'inactive'
  end
$$;

comment on function public.flow_record_kind(boolean, boolean, boolean, text) is
'Canonical flow classifier mirrored from the client engine. Repeating-note helper rows are helpers only while active; inactive hidden helpers are deleted rows.';

create or replace function public.flow_is_deleted_state(
  p_active boolean,
  p_is_hidden boolean,
  p_notes text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_is_hidden, false) = true
    and (
      public.flow_has_repeating_note_metadata(p_notes) = false
      or coalesce(p_active, false) = false
    )
$$;

comment on function public.flow_is_deleted_state(boolean, boolean, text) is
'Deleted-state predicate with active-state awareness. Active repeating-note helpers are live helper rows; inactive hidden helpers are deleted rows.';

create or replace function public.normalize_flow_visibility_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.flow_is_deleted_state(new.active, new.is_hidden, new.notes) then
    new.active := false;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_user_event_flow_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client_flow_id bigint;
  v_detail_flow_id bigint;
  v_flow_active boolean;
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

  select f.active, f.is_hidden, f.notes
    into v_flow_active, v_flow_is_hidden, v_flow_notes
  from public.flows f
  where f.id = new.flow_local_id
  limit 1;

  if not found then
    raise exception 'FLOW_NOT_FOUND';
  end if;

  if public.flow_is_deleted_state(
    v_flow_active,
    v_flow_is_hidden,
    v_flow_notes
  ) then
    raise exception 'FLOW_ALREADY_DELETED';
  end if;

  return new;
end;
$$;

comment on function public.enforce_user_event_flow_integrity() is
'Canonical user_events guard. Leaves tombstones detached, normalizes embedded flow metadata into flow_local_id, prefers import/current owner ids over stale stored ids, and blocks linking events to deleted flows, including inactive repeating-note helpers.';

create or replace function public.purge_deleted_flow_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_was_deleted boolean;
  v_is_deleted boolean;
begin
  v_was_deleted := public.flow_is_deleted_state(
    old.active,
    old.is_hidden,
    old.notes
  );
  v_is_deleted := public.flow_is_deleted_state(
    new.active,
    new.is_hidden,
    new.notes
  );

  if not v_is_deleted then
    return new;
  end if;

  if v_was_deleted and old.share_id is not distinct from new.share_id then
    return new;
  end if;

  delete from public.user_events ue
  where lower(coalesce(ue.category, '')) <> 'tombstone'
    and public.user_event_references_flow(
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
'Deletes every non-tombstone user_events row that references a flow when that flow transitions into the backend deleted state, including inactive repeating-note helpers.';

drop trigger if exists trg_normalize_flow_visibility_state on public.flows;
create trigger trg_normalize_flow_visibility_state
before insert or update of active, is_hidden, notes
on public.flows
for each row
execute function public.normalize_flow_visibility_state();

drop trigger if exists trg_enforce_user_event_flow_integrity on public.user_events;
create trigger trg_enforce_user_event_flow_integrity
before insert or update of flow_local_id, client_event_id, detail, category
on public.user_events
for each row
execute function public.enforce_user_event_flow_integrity();

drop trigger if exists trg_purge_deleted_flow_events on public.flows;
create trigger trg_purge_deleted_flow_events
after update of active, is_hidden, notes, share_id
on public.flows
for each row
execute function public.purge_deleted_flow_events();

with stale_helper_flows as (
  select f.id
  from public.flows f
  where coalesce(f.active, false) = false
    and coalesce(f.is_hidden, false) = true
    and coalesce(f.is_saved, false) = false
    and coalesce(f.is_reminder, false) = false
    and public.flow_has_repeating_note_metadata(f.notes)
)
delete from public.user_events ue
using stale_helper_flows stale
where lower(coalesce(ue.category, '')) <> 'tombstone'
  and public.user_event_references_flow(
    stale.id,
    ue.flow_local_id,
    ue.client_event_id,
    ue.detail
  );

update public.flows f
   set notes = null,
       rules = '[]'::jsonb,
       updated_at = now()
 where coalesce(f.active, false) = false
   and coalesce(f.is_hidden, false) = true
   and coalesce(f.is_saved, false) = false
   and coalesce(f.is_reminder, false) = false
   and public.flow_has_repeating_note_metadata(f.notes);

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
  and public.flow_is_deleted_state(f.active, f.is_hidden, f.notes)
);

notify pgrst, 'reload schema';
