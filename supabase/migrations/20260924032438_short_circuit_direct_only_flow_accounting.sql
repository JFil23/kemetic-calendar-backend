begin;

-- Keep one canonical accountant. Exact partial-index probes select a direct-
-- only branch when no legacy ownership or suppressing tombstones can affect
-- the result; all other calls retain the complete accounting branch below.
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
  v_has_legacy_events boolean;
  v_has_active_tombstones boolean;
begin
  if p_user_id is null then
    return;
  end if;

  if p_flow_ids is not null and cardinality(p_flow_ids) = 0 then
    return;
  end if;

  v_timezone := coalesce(
    nullif(btrim(public._get_user_timezone(p_user_id)), ''),
    'UTC'
  );

  select
    exists (
      select 1
      from public.user_events ue
      where ue.user_id = p_user_id
        and ue.flow_local_id is null
        and public.user_event_referenced_flow_id(
          ue.flow_local_id,
          ue.client_event_id,
          ue.detail
        ) is not null
    )
    or exists (
      select 1
      from public.user_events ue
      where ue.user_id = p_user_id
        and ue.flow_local_id is null
        and ue.action_id is not null
        and nullif(btrim(ue.action_id), '') is not null
        and public.user_event_referenced_flow_id(
          ue.flow_local_id,
          ue.client_event_id,
          ue.detail
        ) is null
    )
  into v_has_legacy_events;

  select exists (
    select 1
    from public.event_deletion_trash edt
    where edt.user_id = p_user_id
      and edt.client_event_id is not null
      and edt.purged_at is null
      and edt.purge_after > timezone('utc', v_now)
      and edt.suppresses_client = true
  )
  into v_has_active_tombstones;

  if not v_has_legacy_events and not v_has_active_tombstones then
    return query
    with
    member_calendars as (
      select distinct sc.id
      from public.shared_calendar_members scm
      join public.shared_calendars sc
        on sc.id = scm.calendar_id
       and sc.deleted_at is null
      where scm.user_id = p_user_id
        and scm.status = 'accepted'
    ),
    flow_inputs as (
      select
        f.id,
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes,
        f.end_date,
        case
          when coalesce(f.active, false) then
            public.flow_has_repeating_note_metadata(f.notes)
          else false
        end as is_active_repeating_note
      from public.flows f
      join member_calendars mc
        on mc.id = f.calendar_id
      where f.user_id = p_user_id
        and (
          p_flow_ids is null
          or f.id = any(p_flow_ids)
        )
    ),
    candidate_flows as materialized (
      select
        fi.id,
        fi.active,
        fi.is_hidden,
        fi.is_reminder,
        case
          when coalesce(fi.is_reminder, false) then 'reminder'
          when fi.is_active_repeating_note then 'hiddenHelper'
          when coalesce(fi.is_hidden, false) then 'softDeleted'
          when coalesce(fi.active, false) then 'active'
          else 'inactive'
        end as record_kind,
        public.flow_is_schedule_open(
          fi.end_date,
          v_timezone,
          v_now
        ) as schedule_open
      from flow_inputs fi
      where coalesce(fi.is_hidden, false) = false
         or fi.is_active_repeating_note
    ),
    candidate_flow_ids as (
      select coalesce(
        array_agg(cf.id order by cf.id),
        '{}'::bigint[]
      ) as ids
      from candidate_flows cf
    ),
    direct_events as (
      select
        ue.flow_local_id as flow_id,
        ue.client_event_id,
        ue.category,
        ue.all_day,
        ue.starts_at,
        ue.ends_at
      from public.user_events ue
      cross join candidate_flow_ids cfi
      where ue.user_id = p_user_id
        and ue.flow_local_id = any(cfi.ids)
    ),
    completion_keys as (
      select
        uec.flow_id,
        uec.client_event_id
      from candidate_flows cf
      join public.user_event_completions uec
        on uec.user_id = p_user_id
       and uec.flow_id = cf.id
    ),
    event_rows as (
      select
        de.flow_id,
        de.client_event_id,
        (
          case
            when de.starts_at is null then null::timestamptz
            when coalesce(de.all_day, false) then
              case
                when de.ends_at is not null and de.ends_at > de.starts_at
                  then de.ends_at
                else (
                  (de.starts_at at time zone v_timezone)::date
                  + interval '1 day'
                ) at time zone v_timezone
              end
            when de.ends_at is not null and de.ends_at > de.starts_at
              then de.ends_at
            else de.starts_at
          end
        ) >= v_now as is_live,
        (
          lower(coalesce(de.category, '')) = 'tombstone'
          or lower(coalesce(de.client_event_id, ''))
            like 'reminder:tombstone:%'
          or lower(coalesce(de.client_event_id, '')) like 'maat:%'
        ) as is_deleted,
        (completion.flow_id is not null) as is_completed
      from direct_events de
      left join completion_keys completion
        on completion.flow_id = de.flow_id
       and completion.client_event_id = de.client_event_id
    ),
    event_counts as (
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
      coalesce(ec.inactive_event_count, 0)::bigint
        as inactive_event_count,
      coalesce(ec.completed_event_count, 0)::bigint
        as completed_event_count,
      coalesce(ec.remaining_event_count, 0)::bigint
        as remaining_event_count,
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

    return;
  end if;

  return query
  with
  member_calendars as (
    select distinct sc.id
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
     and sc.deleted_at is null
    where scm.user_id = p_user_id
      and scm.status = 'accepted'
  ),
  flow_inputs as (
    select
      f.id,
      f.active,
      f.is_hidden,
      f.is_reminder,
      f.notes,
      f.ai_metadata,
      f.end_date,
      f.updated_at,
      case
        when coalesce(f.active, false) then
          public.flow_has_repeating_note_metadata(f.notes)
        else false
      end as is_active_repeating_note
    from public.flows f
    join member_calendars mc
      on mc.id = f.calendar_id
    where f.user_id = p_user_id
      and (
        p_flow_ids is null
        or f.id = any(p_flow_ids)
      )
  ),
  candidate_flows as materialized (
    select
      fi.id,
      fi.active,
      fi.is_hidden,
      fi.is_reminder,
      fi.ai_metadata,
      fi.updated_at,
      case
        when coalesce(fi.is_reminder, false) then 'reminder'
        when fi.is_active_repeating_note then 'hiddenHelper'
        when coalesce(fi.is_hidden, false) then 'softDeleted'
        when coalesce(fi.active, false) then 'active'
        else 'inactive'
      end as record_kind,
      public.flow_is_schedule_open(
        fi.end_date,
        v_timezone,
        v_now
      ) as schedule_open
    from flow_inputs fi
    where coalesce(fi.is_hidden, false) = false
       or fi.is_active_repeating_note
  ),
  candidate_flow_ids as (
    select coalesce(
      array_agg(cf.id order by cf.id),
      '{}'::bigint[]
    ) as ids
    from candidate_flows cf
  ),
  direct_events as (
    select
      ue.id as event_id,
      ue.flow_local_id as flow_id,
      ue.client_event_id,
      ue.category,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    from public.user_events ue
    cross join candidate_flow_ids cfi
    where ue.user_id = p_user_id
      and ue.flow_local_id = any(cfi.ids)
  ),
  referenced_fallback_events as (
    select
      ue.id as event_id,
      cf.id as flow_id,
      ue.client_event_id,
      ue.category,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    from public.user_events ue
    join candidate_flows cf
      on cf.id = public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      )
    where ue.user_id = p_user_id
      and ue.flow_local_id is null
      and public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      ) is not null
  ),
  unresolved_actions as materialized (
    select distinct btrim(ue.action_id) as action_id
    from public.user_events ue
    where ue.user_id = p_user_id
      and ue.flow_local_id is null
      and ue.action_id is not null
      and nullif(btrim(ue.action_id), '') is not null
      and public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      ) is null
  ),
  action_flow_matches as materialized (
    select distinct on (ua.action_id)
      ua.action_id,
      cf.id as flow_id
    from unresolved_actions ua
    join candidate_flows cf
      on public.flow_metadata_has_action_id(
        cf.ai_metadata,
        ua.action_id
      )
    order by
      ua.action_id,
      case cf.record_kind
        when 'active' then 0
        when 'inactive' then 1
        else 2
      end,
      cf.updated_at desc nulls last,
      cf.id desc
  ),
  action_fallback_events as (
    select
      ue.id as event_id,
      cf.id as flow_id,
      ue.client_event_id,
      ue.category,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    from action_flow_matches afm
    join public.user_events ue
      on ue.user_id = p_user_id
     and ue.flow_local_id is null
     and ue.action_id is not null
     and btrim(ue.action_id) = afm.action_id
    join candidate_flows cf
      on cf.id = afm.flow_id
    where public.user_event_referenced_flow_id(
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail
    ) is null
  ),
  event_source as materialized (
    select * from direct_events
    union all
    select * from referenced_fallback_events
    union all
    select * from action_fallback_events
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
  reminder_refs as materialized (
    select
      es.event_id,
      public.user_event_reminder_uuid(es.client_event_id) as reminder_uuid
    from event_source es
    where exists (select 1 from active_tombstones)
      and lower(coalesce(es.client_event_id, '')) like 'reminder:%'
  ),
  tombstone_keys as (
    select es.event_id, es.client_event_id
    from event_source es
    where exists (select 1 from active_tombstones)
      and nullif(btrim(coalesce(es.client_event_id, '')), '') is not null

    union all

    select rr.event_id, 'reminder:' || rr.reminder_uuid::text
    from reminder_refs rr
    where rr.reminder_uuid is not null

    union all

    select rr.event_id, 'reminder:rule:' || rr.reminder_uuid::text
    from reminder_refs rr
    where rr.reminder_uuid is not null
  ),
  tombstoned_events as (
    select distinct tk.event_id
    from tombstone_keys tk
    join active_tombstones at
      on at.client_event_id = tk.client_event_id
  ),
  completion_keys as (
    select
      uec.flow_id,
      uec.client_event_id
    from candidate_flows cf
    join public.user_event_completions uec
      on uec.user_id = p_user_id
     and uec.flow_id = cf.id
  ),
  event_rows as (
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
      ) as is_deleted,
      (completion.flow_id is not null) as is_completed
    from event_source es
    left join tombstoned_events te
      on te.event_id = es.event_id
    left join completion_keys completion
      on completion.flow_id = es.flow_id
     and completion.client_event_id = es.client_event_id
  ),
  event_counts as (
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
'Canonical set-based flow activity summary. Exact indexed guards use direct-only accounting only when neither legacy ownership nor active suppressing tombstones can affect the result.';

commit;
