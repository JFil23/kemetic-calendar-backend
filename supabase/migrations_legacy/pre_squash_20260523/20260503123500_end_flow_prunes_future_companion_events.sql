create or replace function public.flow_action_ids_from_metadata(
  p_ai_metadata jsonb
)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  with event_snapshot as (
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb) -> 'event_snapshot') = 'array'
          then coalesce(p_ai_metadata, '{}'::jsonb) -> 'event_snapshot'
        else '[]'::jsonb
      end
    )
  ),
  plan_actions as (
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb) #> '{plan_spec,actions}') = 'array'
          then coalesce(p_ai_metadata, '{}'::jsonb) #> '{plan_spec,actions}'
        else '[]'::jsonb
      end
    )
  ),
  notes as (
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb) -> 'notes') = 'array'
          then coalesce(p_ai_metadata, '{}'::jsonb) -> 'notes'
        else '[]'::jsonb
      end
    )
  ),
  ids as (
    select nullif(btrim(value ->> 'action_id'), '') as action_id
    from event_snapshot
    union
    select nullif(btrim(value ->> 'action_id'), '') as action_id
    from plan_actions
    union
    select nullif(btrim(value ->> 'action_id'), '') as action_id
    from notes
  )
  select coalesce(array_agg(distinct action_id), array[]::text[])
  from ids
  where action_id is not null
$$;

comment on function public.flow_action_ids_from_metadata(jsonb) is
'Extracts generated event action ids from flow ai_metadata snapshots and plan specs so companion rows remain flow-owned even if flow_local_id drifted.';

create or replace function public.flow_metadata_has_action_id(
  p_ai_metadata jsonb,
  p_action_id text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(coalesce(p_action_id, '')), '') is not null
    and btrim(p_action_id) = any(public.flow_action_ids_from_metadata(p_ai_metadata))
$$;

create or replace function public.flow_id_from_action_id(
  p_user_id uuid,
  p_action_id text
)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select f.id
  from public.flows f
  where f.user_id = p_user_id
    and public.flow_metadata_has_action_id(f.ai_metadata, p_action_id)
  order by
    case public.flow_record_kind(f.active, f.is_hidden, f.is_reminder, f.notes)
      when 'active' then 0
      when 'inactive' then 1
      else 2
    end,
    f.updated_at desc nulls last,
    f.id desc
  limit 1
$$;

comment on function public.flow_id_from_action_id(uuid, text) is
'Finds the owning flow for generated event/action companion rows when the row lost flow_local_id and only kept action_id.';

create or replace function public.user_event_matches_flow(
  p_flow_id bigint,
  p_flow_local_id bigint,
  p_client_event_id text,
  p_detail text,
  p_action_id text,
  p_flow_ai_metadata jsonb
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.user_event_references_flow(
      p_flow_id,
      p_flow_local_id,
      p_client_event_id,
      p_detail
    )
    or public.flow_metadata_has_action_id(p_flow_ai_metadata, p_action_id)
$$;

comment on function public.user_event_matches_flow(bigint, bigint, text, text, text, jsonb) is
'Canonical flow-event match for destructive lifecycle operations: embedded flow ids first, generated action ids second.';

create or replace function public.enforce_user_event_flow_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client_flow_id bigint;
  v_detail_flow_id bigint;
  v_action_flow_id bigint;
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
  v_action_flow_id := public.flow_id_from_action_id(new.user_id, new.action_id);

  new.flow_local_id := coalesce(
    v_client_flow_id,
    v_detail_flow_id,
    v_action_flow_id,
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
'Canonical user_events guard. Leaves tombstones detached, normalizes embedded flow metadata and generated action ids into flow_local_id, prefers import/current owner ids over stale stored ids, and blocks linking events to deleted flows.';

drop trigger if exists trg_enforce_user_event_flow_integrity on public.user_events;
create trigger trg_enforce_user_event_flow_integrity
before insert or update of flow_local_id, client_event_id, detail, category, action_id
on public.user_events
for each row
execute function public.enforce_user_event_flow_integrity();

create or replace function public.purge_ended_flow_future_events()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz;
begin
  if coalesce(new.active, false) then
    return new;
  end if;

  if public.flow_is_deleted_state(new.active, new.is_hidden, new.notes) then
    return new;
  end if;

  if coalesce(old.active, false) = false
     and old.end_date is not distinct from new.end_date then
    return new;
  end if;

  v_cutoff := coalesce(new.updated_at, now());

  delete from public.user_events ue
  where lower(coalesce(ue.category, '')) <> 'tombstone'
    and ue.starts_at >= v_cutoff
    and public.user_event_matches_flow(
      new.id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail,
      ue.action_id,
      new.ai_metadata
    );

  return new;
end;
$$;

comment on function public.purge_ended_flow_future_events() is
'When a flow is ended, deletes future materialized and generated companion event rows from the actual end moment instead of leaving same-day reflection notes behind.';

drop trigger if exists trg_purge_ended_flow_future_events on public.flows;
create trigger trg_purge_ended_flow_future_events
after update of active, end_date
on public.flows
for each row
execute function public.purge_ended_flow_future_events();

update public.user_events ue
   set flow_local_id = public.flow_id_from_action_id(ue.user_id, ue.action_id)
 where ue.flow_local_id is null
   and nullif(btrim(coalesce(ue.action_id, '')), '') is not null
   and public.flow_id_from_action_id(ue.user_id, ue.action_id) is not null;

delete from public.user_events ue
using public.flows f
where coalesce(f.active, false) = false
  and public.flow_is_deleted_state(f.active, f.is_hidden, f.notes) = false
  and lower(coalesce(ue.category, '')) <> 'tombstone'
  and ue.starts_at > coalesce(f.updated_at, now())
  and public.user_event_matches_flow(
    f.id,
    ue.flow_local_id,
    ue.client_event_id,
    ue.detail,
    ue.action_id,
    f.ai_metadata
  );

notify pgrst, 'reload schema';
