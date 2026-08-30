-- A Reading House is one flow identity before and after sitting events exist.
-- Accepted shared-calendar membership is the existing house-membership authority.
create or replace function private.flow_is_reading_house(
  p_notes text,
  p_ai_metadata jsonb
)
returns boolean
language sql
immutable
set search_path = public, private, pg_temp
as $$
  select
    nullif(btrim(coalesce(p_ai_metadata ->> 'flow_key', '')), '') =
      'the-reading-house'
    or coalesce(p_notes, '') ~ '(^|;)maat=the-reading-house(;|$)'
    or coalesce(p_notes, '') ~ '(^|;)reading_house_[^;]*='
$$;

revoke all on function private.flow_is_reading_house(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.flow_is_reading_house(text, jsonb)
  to service_role;

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
      private.flow_is_reading_house(f.notes, f.ai_metadata) as is_reading_house,
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
    where (
        f.user_id = p_user_id
        or private.flow_is_reading_house(f.notes, f.ai_metadata)
      )
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
    where ue.user_id = p_user_id
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
      ) as live_event_count,
      count(*) filter (
        where not er.is_deleted
          and not coalesce(er.is_live, false)
      ) as inactive_event_count,
      count(*) filter (
        where not er.is_deleted
          and er.completion_id is not null
      ) as completed_event_count,
      count(*) filter (
        where not er.is_deleted
          and (
            er.client_event_id is null
            or btrim(er.client_event_id) = ''
            or er.completion_id is null
          )
      ) as remaining_event_count,
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
      and (
        coalesce(ec.remaining_live_event_count, 0) > 0
        or cf.is_reading_house
      )
    ) as is_counted_active
  from candidate_flows cf
  left join event_counts ec
    on ec.flow_id = cf.id
  order by cf.id;
end;
$$;

create or replace function public.get_my_filed_flows_v1(
  p_limit integer default null
)
returns table (
  id bigint,
  user_id uuid,
  calendar_id uuid,
  name text,
  color bigint,
  active boolean,
  is_saved boolean,
  start_date date,
  end_date date,
  notes text,
  rules jsonb,
  ai_metadata jsonb,
  is_hidden boolean,
  is_reminder boolean,
  reminder_uuid uuid,
  share_id uuid,
  origin_share_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  saved_at timestamptz,
  lifecycle text,
  visible_in_active_list boolean,
  visible_in_saved_list boolean,
  total_event_count bigint,
  remaining_event_count bigint,
  remaining_live_event_count bigint,
  is_shared boolean,
  is_posted boolean,
  is_shared_calendar_source boolean,
  is_flow_share_source boolean
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  return query
  with flow_rows as materialized (
    select
      f.*,
      sc.is_personal as calendar_is_personal,
      fsaves.saved_at as flow_saved_at,
      (
        coalesce(f.is_saved, false)
        or fsaves.flow_id is not null
      ) as filed_is_saved,
      public.flow_record_kind(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      ) as record_kind,
      exists (
        select 1
        from public.flow_shares fshare
        where fshare.flow_id = f.id
          and fshare.deleted_at is null
          and coalesce(fshare.status, 'pending')
            in ('sent', 'viewed', 'imported', 'public')
      ) as has_flow_share,
      exists (
        select 1
        from public.flow_posts fp
        where fp.flow_id = f.id
          and coalesce(fp.is_hidden, false) = false
      ) as has_flow_post
    from public.flows f
    join public.shared_calendars sc
      on sc.id = f.calendar_id
     and sc.deleted_at is null
    left join public.flow_saves fsaves
      on fsaves.flow_id = f.id
     and fsaves.user_id = v_uid
    where (
        f.user_id = v_uid
        or private.flow_is_reading_house(f.notes, f.ai_metadata)
      )
      and exists (
        select 1
        from public.shared_calendar_members scm
        where scm.calendar_id = f.calendar_id
          and scm.user_id = v_uid
          and scm.status = 'accepted'
      )
  )
  select
    f.id,
    f.user_id,
    f.calendar_id,
    f.name,
    f.color,
    f.active,
    f.filed_is_saved as is_saved,
    f.start_date,
    f.end_date,
    f.notes,
    f.rules,
    f.ai_metadata,
    coalesce(f.is_hidden, false) as is_hidden,
    coalesce(f.is_reminder, false) as is_reminder,
    f.reminder_uuid,
    f.share_id,
    f.origin_share_id,
    f.created_at,
    f.updated_at,
    f.flow_saved_at as saved_at,
    case
      when summary.is_counted_active then 'active'
      else 'inactive'
    end as lifecycle,
    summary.is_counted_active as visible_in_active_list,
    (
      f.filed_is_saved
      and coalesce(f.is_reminder, false) = false
      and f.record_kind in ('active', 'inactive')
    ) as visible_in_saved_list,
    summary.total_event_count,
    summary.remaining_event_count,
    summary.remaining_live_event_count,
    (
      coalesce(f.calendar_is_personal, true) = false
      or f.has_flow_share
    ) as is_shared,
    f.has_flow_post as is_posted,
    (coalesce(f.calendar_is_personal, true) = false)
      as is_shared_calendar_source,
    f.has_flow_share as is_flow_share_source
  from flow_rows f
  join private.flow_activity_summary_v1(v_uid, null) summary
    on summary.flow_id = f.id
  order by f.created_at desc
  limit p_limit;
end;
$$;

-- Profile counters remain creator-owned. Reading House membership broadens
-- My Flows, not the public meaning of another person's authored-flow count.
create or replace function public.get_profile_flow_counts(p_user_id uuid)
returns table (
  active_flows_count bigint,
  total_flow_events_count bigint
)
language sql
security definer
stable
set search_path = public, private, pg_temp
as $$
  select
    count(*) filter (
      where summary.is_counted_active
    ) as active_flows_count,
    coalesce(
      sum(summary.remaining_live_event_count) filter (
        where summary.is_counted_active
      ),
      0
    ) as total_flow_events_count
  from private.flow_activity_summary_v1(p_user_id, null) summary
  join public.flows f
    on f.id = summary.flow_id
   and f.user_id = p_user_id
$$;

revoke all on function private.flow_activity_summary_v1(uuid, bigint[])
  from public, anon, authenticated;
grant execute on function private.flow_activity_summary_v1(uuid, bigint[])
  to service_role;

revoke all on function public.get_my_filed_flows_v1(integer) from public;
revoke all on function public.get_my_filed_flows_v1(integer) from anon;
grant execute on function public.get_my_filed_flows_v1(integer)
  to authenticated;

comment on function private.flow_is_reading_house(text, jsonb) is
'Canonical Reading House identity detector used by filing/accounting consumers.';
comment on function private.flow_activity_summary_v1(uuid, bigint[]) is
'Set-based flow filing accountant including accepted Reading House members and zero-event unscheduled houses.';
comment on function public.get_my_filed_flows_v1(integer) is
'Authenticated My Flows rows including the same unscheduled Reading House for creators and accepted members.';
comment on function public.get_profile_flow_counts(uuid) is
'Creator-owned profile flow counts; accepted Reading House membership is intentionally limited to My Flows.';

notify pgrst, 'reload schema';
