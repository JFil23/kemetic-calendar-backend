-- Keep canonical action-id extraction and caller RLS; make the fallback indexable.
create or replace function public.flow_metadata_has_action_id(
  p_ai_metadata jsonb, p_action_id text
)
returns boolean
language sql immutable
-- Keep this predicate inlineable so callers can use the expression index.
-- All functions and operators in the expression are schema-qualified.
as $$
  select nullif(pg_catalog.btrim(coalesce(p_action_id, '')), '') is not null
    and public.flow_action_ids_from_metadata(p_ai_metadata) operator(pg_catalog.@>) array[pg_catalog.btrim(p_action_id)]
$$;

create index if not exists flows_action_ids_lookup_idx
  on public.flows using gin (public.flow_action_ids_from_metadata(ai_metadata));

create or replace function public.flow_id_from_action_id(
  p_user_id uuid, p_action_id text
)
returns bigint
language sql stable
set search_path = public, pg_temp
as $$
  select case
    when p_user_id is null or nullif(btrim(coalesce(p_action_id, '')), '') is null then null::bigint
    else (
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
    )
  end
$$;

