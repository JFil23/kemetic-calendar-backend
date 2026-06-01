-- Phase 4: canonical outcome vector builder

create or replace function public.get_recent_outcome_vectors(
  p_user_id uuid,
  p_limit integer default 6
) returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_limit integer;
begin
  v_uid := auth.uid();
  v_role := current_setting('request.jwt.claims.role', true);
  v_limit := coalesce(p_limit, 6);
  v_limit := greatest(0, least(v_limit, 20)); -- hard cap to keep payload small

  -- Authz: require caller to request their own vectors, except service_role for debugging
  if v_uid is null then
    if v_role = 'service_role' and p_user_id is not null then
      v_uid := p_user_id;
    else
      raise exception 'unauthenticated';
    end if;
  end if;

  if p_user_id is distinct from v_uid then
    raise exception 'unauthorized for user %', coalesce(p_user_id::text, '<null>');
  end if;

  return query
  select jsonb_build_object(
    'vector_version', 'ov_v1',
    'window_start', o.window_start,
    'window_end', o.window_end,
    'flow_id', o.flow_id,
    'origin_type', f.origin_type,
    'origin_generation_id', f.origin_generation_id,
    'schedule_density', (
      case
        when o.window_start is not null and o.window_end is not null then
          coalesce(
            (o.metadata->>'schedule_density')::numeric,
            case
              when (o.metadata->>'scheduled_days') is not null then
                round(((o.metadata->>'scheduled_days')::numeric / greatest(((o.window_end - o.window_start) + 1), 1))::numeric, 4)
              else null::numeric
            end
          )
        else (o.metadata->>'schedule_density')::numeric
      end
    ),
    'journal_density', (
      case
        when o.window_start is not null
         and o.window_end is not null
         and (o.metadata->>'journal_days') is not null then
          round(((o.metadata->>'journal_days')::numeric / greatest(((o.window_end - o.window_start) + 1), 1))::numeric, 4)
        else null::numeric
      end
    ),
    'events_total', o.events_total,
    'events_completed', o.events_completed,
    'completion_ratio', (
      case
        when coalesce(o.events_total, 0) = 0 then null
        else coalesce(
          (o.metadata->>'completion_ratio')::numeric,
          case
            when o.events_completed is not null then round((o.events_completed::numeric / nullif(o.events_total, 0))::numeric, 4)
            else null::numeric
          end
        )
      end
    ),
    'badge_count', (o.metadata->>'badge_count')::integer,
    'edit_count', o.edit_count,
    'edit_pressure', (
      case
        when coalesce(o.events_total, 0) = 0 then null
        when o.edit_count is null then null
        else round((o.edit_count::numeric / nullif(o.events_total, 0))::numeric, 4)
      end
    ),
    'accepted_as_is', o.accepted_as_is,
    'outcome_confidence', o.metadata->>'outcome_confidence',
    'lower_bounds', jsonb_build_object(
      'edit_count', true,
      'badge_count', true
    ),
    'journal_days', (o.metadata->>'journal_days')::integer,
    'scheduled_days', (o.metadata->>'scheduled_days')::integer,
    'n_days', (
      case
        when o.window_start is not null and o.window_end is not null
          then (o.window_end - o.window_start) + 1
        else null
      end
    )
  )
  from public.flow_outcomes o
  join public.flows f
    on f.id = o.flow_id
   and f.user_id = o.user_id
  where o.user_id = v_uid
  order by o.recorded_at desc
  limit v_limit;
end;
$$;

comment on function public.get_recent_outcome_vectors(uuid, integer) is
'Phase 4: returns recent ov_v1 outcome vectors for the current user (or explicit user when service_role), joining flow_outcomes + flows.';

revoke all on function public.get_recent_outcome_vectors(uuid, integer) from public;
grant execute on function public.get_recent_outcome_vectors(uuid, integer) to authenticated;
grant execute on function public.get_recent_outcome_vectors(uuid, integer) to service_role;
