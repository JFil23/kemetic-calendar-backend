create or replace function public.get_my_flow_activity_v1(
  p_flow_ids bigint[] default null
)
returns table (
  flow_id bigint,
  total_event_count bigint,
  remaining_event_count bigint,
  is_counted_active boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_timezone text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_timezone := coalesce(
    nullif(btrim(public._get_user_timezone(v_uid)), ''),
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
    where f.user_id = v_uid
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
          and scm.user_id = v_uid
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
      on ue.user_id = v_uid
     and ue.flow_local_id = cf.id
  ),
  fallback_base as materialized (
    select
      ue.id as event_id,
      ue.user_id,
      ue.client_event_id,
      ue.category,
      ue.all_day,
      ue.starts_at,
      ue.ends_at,
      ue.action_id,
      public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      ) as referenced_flow_id
    from public.user_events ue
    where ue.user_id = v_uid
      and ue.flow_local_id is null
  ),
  unresolved_actions as materialized (
    select distinct btrim(fb.action_id) as action_id
    from fallback_base fb
    where fb.referenced_flow_id is null
      and nullif(btrim(coalesce(fb.action_id, '')), '') is not null
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
  fallback_events as materialized (
    select
      fb.event_id,
      cf.id as flow_id,
      fb.user_id,
      fb.client_event_id,
      fb.category,
      fb.all_day,
      fb.starts_at,
      fb.ends_at,
      cf.active as flow_active,
      cf.is_hidden as flow_is_hidden,
      cf.notes as flow_notes
    from fallback_base fb
    left join action_flow_matches afm
      on afm.action_id = btrim(fb.action_id)
    join candidate_flows cf
      on cf.id = coalesce(fb.referenced_flow_id, afm.flow_id)
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
    where edt.user_id = v_uid
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
  event_rows as materialized (
    select
      es.flow_id,
      es.client_event_id,
      (
        case
          when es.starts_at is null then false
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
      uec.id as completion_id
    from event_source es
    left join tombstoned_events te
      on te.event_id = es.event_id
    left join public.user_event_completions uec
      on uec.user_id = es.user_id
     and uec.flow_id = es.flow_id
     and uec.client_event_id = es.client_event_id
  ),
  event_counts as materialized (
    select
      er.flow_id,
      count(*) filter (where not er.is_deleted) as total_event_count,
      count(*) filter (
        where not er.is_deleted
          and er.is_live
          and (
            er.client_event_id is null
            or btrim(er.client_event_id) = ''
            or er.completion_id is null
          )
      ) as remaining_live_event_count
    from event_rows er
    group by er.flow_id
  )
  select
    cf.id as flow_id,
    coalesce(ec.total_event_count, 0)::bigint as total_event_count,
    coalesce(ec.remaining_live_event_count, 0)::bigint
      as remaining_event_count,
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

comment on function public.get_my_flow_activity_v1(bigint[]) is
'Versioned authenticated flow accountant. Bounds candidate flows to requested IDs and derives total/remaining-live counts from base event, completion, and tombstone tables without expanding flow_filing_items_client.';

revoke all on function public.get_my_flow_activity_v1(bigint[]) from public;
revoke all on function public.get_my_flow_activity_v1(bigint[]) from anon;
grant execute on function public.get_my_flow_activity_v1(bigint[])
  to authenticated;

notify pgrst, 'reload schema';
