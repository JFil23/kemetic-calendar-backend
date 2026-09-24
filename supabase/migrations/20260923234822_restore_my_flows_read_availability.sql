begin;

-- Preserve the existing accountant's row and count semantics while removing
-- its two unbounded joins. A fallback event is resolved once from its stored
-- references, and flow action ids are expanded once per candidate flow.
create or replace function private.flow_activity_summary_v1(
  p_user_id uuid,
  p_flow_ids bigint[] default null
)
returns table (
  flow_id bigint,
  total_event_count bigint,
  live_event_count bigint,
  inactive_event_count bigint,
  completed_event_count bigint,
  remaining_event_count bigint,
  remaining_live_event_count bigint,
  is_counted_active boolean
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_timezone text;
begin
  if p_user_id is null then
    return;
  end if;

  v_timezone := coalesce(
    nullif(btrim(public._get_user_timezone(p_user_id)), ''),
    'UTC'
  );

  return query
  with
  candidate_flows as materialized (
    select
      f.id,
      f.active,
      f.is_hidden,
      f.is_reminder,
      f.notes,
      f.ai_metadata,
      f.updated_at,
      public.flow_record_kind(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      ) as record_kind,
      public.flow_is_schedule_open(
        f.end_date,
        v_timezone,
        v_now
      ) as schedule_open
    from public.flows f
    join public.shared_calendars sc
      on sc.id = f.calendar_id
     and sc.deleted_at is null
    where f.user_id = p_user_id
      and (
        p_flow_ids is null
        or f.id = any(p_flow_ids)
      )
      and public.flow_is_deleted_state(
        f.active,
        f.is_hidden,
        f.notes
      ) = false
      and exists (
        select 1
        from public.shared_calendar_members scm
        where scm.calendar_id = f.calendar_id
          and scm.user_id = p_user_id
          and scm.status = 'accepted'
      )
  ),
  direct_events as materialized (
    select
      ue.id as event_id,
      cf.id as flow_id,
      ue.user_id,
      ue.client_event_id,
      ue.category,
      ue.all_day,
      ue.starts_at,
      ue.ends_at,
      cf.active as flow_active,
      cf.is_hidden as flow_is_hidden,
      cf.notes as flow_notes
    from candidate_flows cf
    join public.user_events ue
      on ue.user_id = p_user_id
     and ue.flow_local_id = cf.id
  ),
  referenced_fallback_events as materialized (
    select
      ue.id as event_id,
      cf.id as flow_id,
      ue.user_id,
      ue.client_event_id,
      ue.category,
      ue.all_day,
      ue.starts_at,
      ue.ends_at,
      cf.active as flow_active,
      cf.is_hidden as flow_is_hidden,
      cf.notes as flow_notes
    from public.user_events ue
    join candidate_flows cf
      on cf.id = public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      )
    where ue.user_id = p_user_id
      and ue.flow_local_id is null
  ),
  flow_action_map as materialized (
    select
      cf.id as flow_id,
      cf.record_kind,
      cf.updated_at,
      action_id
    from candidate_flows cf
    cross join lateral unnest(
      public.flow_action_ids_from_metadata(cf.ai_metadata)
    ) action_id
  ),
  action_flow_matches as materialized (
    select distinct on (fam.action_id)
      fam.action_id,
      fam.flow_id
    from flow_action_map fam
    order by
      fam.action_id,
      case fam.record_kind
        when 'active' then 0
        when 'inactive' then 1
        else 2
      end,
      fam.updated_at desc nulls last,
      fam.flow_id desc
  ),
  action_fallback_events as materialized (
    select
      ue.id as event_id,
      cf.id as flow_id,
      ue.user_id,
      ue.client_event_id,
      ue.category,
      ue.all_day,
      ue.starts_at,
      ue.ends_at,
      cf.active as flow_active,
      cf.is_hidden as flow_is_hidden,
      cf.notes as flow_notes
    from action_flow_matches afm
    join public.user_events ue
      on ue.user_id = p_user_id
     and ue.flow_local_id is null
     and btrim(ue.action_id) = afm.action_id
    join candidate_flows cf
      on cf.id = afm.flow_id
    where public.user_event_referenced_flow_id(
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail
    ) is null
  ),
  fallback_events as materialized (
    select * from referenced_fallback_events
    union all
    select * from action_fallback_events
  ),
  event_source as materialized (
    select * from direct_events
    union all
    select * from fallback_events
  ),
  reminder_refs as materialized (
    select
      es.event_id,
      public.user_event_reminder_uuid(es.client_event_id) as reminder_uuid
    from event_source es
    where lower(coalesce(es.client_event_id, '')) like 'reminder:%'
  ),
  tombstone_keys as materialized (
    select es.event_id, es.client_event_id
    from event_source es
    where nullif(btrim(coalesce(es.client_event_id, '')), '') is not null

    union all

    select rr.event_id, 'reminder:' || rr.reminder_uuid::text
    from reminder_refs rr
    where rr.reminder_uuid is not null

    union all

    select rr.event_id, 'reminder:rule:' || rr.reminder_uuid::text
    from reminder_refs rr
    where rr.reminder_uuid is not null
  ),
  active_tombstones as materialized (
    select edt.client_event_id
    from public.event_deletion_trash edt
    where edt.user_id = p_user_id
      and edt.client_event_id is not null
      and edt.purged_at is null
      and edt.purge_after > timezone('utc', v_now)
      and edt.suppresses_client = true
  ),
  tombstoned_events as materialized (
    select distinct tk.event_id
    from tombstone_keys tk
    join active_tombstones at
      on at.client_event_id = tk.client_event_id
  ),
  completion_keys as materialized (
    select
      uec.flow_id,
      uec.client_event_id
    from candidate_flows cf
    join public.user_event_completions uec
      on uec.user_id = p_user_id
     and uec.flow_id = cf.id
  ),
  event_rows as materialized (
    select
      es.flow_id,
      es.client_event_id,
      (
        case
          when es.starts_at is null then null::timestamptz
          when coalesce(es.all_day, false) then
            case
              when es.ends_at is not null and es.ends_at > es.starts_at
                then es.ends_at
              else (
                (es.starts_at at time zone v_timezone)::date
                + interval '1 day'
              ) at time zone v_timezone
            end
          when es.ends_at is not null and es.ends_at > es.starts_at
            then es.ends_at
          else es.starts_at
        end
      ) >= v_now as is_live,
      (
        lower(coalesce(es.category, '')) = 'tombstone'
        or lower(coalesce(es.client_event_id, '')) like 'reminder:tombstone:%'
        or lower(coalesce(es.client_event_id, '')) like 'maat:%'
        or te.event_id is not null
        or public.flow_is_deleted_state(
          es.flow_active,
          es.flow_is_hidden,
          es.flow_notes
        )
      ) as is_deleted,
      (completion.flow_id is not null) as is_completed
    from event_source es
    left join tombstoned_events te
      on te.event_id = es.event_id
    left join completion_keys completion
      on completion.flow_id = es.flow_id
     and completion.client_event_id = es.client_event_id
  ),
  event_counts as materialized (
    select
      er.flow_id,
      count(*) filter (where not er.is_deleted) as total_event_count,
      count(*) filter (
        where not er.is_deleted
          and er.is_live
      ) as live_event_count,
      count(*) filter (
        where not er.is_deleted
          and not coalesce(er.is_live, false)
      ) as inactive_event_count,
      count(*) filter (
        where not er.is_deleted
          and er.is_completed
      ) as completed_event_count,
      count(*) filter (
        where not er.is_deleted
          and (
            er.client_event_id is null
            or btrim(er.client_event_id) = ''
            or not er.is_completed
          )
      ) as remaining_event_count,
      count(*) filter (
        where not er.is_deleted
          and er.is_live
          and (
            er.client_event_id is null
            or btrim(er.client_event_id) = ''
            or not er.is_completed
          )
      ) as remaining_live_event_count
    from event_rows er
    group by er.flow_id
  )
  select
    cf.id as flow_id,
    coalesce(ec.total_event_count, 0)::bigint as total_event_count,
    coalesce(ec.live_event_count, 0)::bigint as live_event_count,
    coalesce(ec.inactive_event_count, 0)::bigint as inactive_event_count,
    coalesce(ec.completed_event_count, 0)::bigint as completed_event_count,
    coalesce(ec.remaining_event_count, 0)::bigint as remaining_event_count,
    coalesce(ec.remaining_live_event_count, 0)::bigint
      as remaining_live_event_count,
    (
      coalesce(cf.is_reminder, false) = false
      and cf.record_kind <> 'hiddenHelper'
      and coalesce(cf.active, false) = true
      and cf.schedule_open
      and coalesce(ec.remaining_live_event_count, 0) > 0
    ) as is_counted_active
  from candidate_flows cf
  left join event_counts ec
    on ec.flow_id = cf.id
  order by cf.id;
end;
$$;

revoke all on function private.flow_activity_summary_v1(uuid, bigint[])
  from public, anon, authenticated;
grant execute on function private.flow_activity_summary_v1(uuid, bigint[])
  to service_role;

comment on function private.flow_activity_summary_v1(uuid, bigint[]) is
'Canonical set-based flow activity summary. Direct and legacy event ownership are each resolved once, flow action ids are expanded once per candidate flow, and completion keys are read through the selected flow set.';

commit;
