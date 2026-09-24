begin;

-- Preserve the sole My Flows public authority and its return contract. The
-- former filter parsed repeating-note metadata twice per owned flow through
-- two equivalent helpers. Resolve that state once, run canonical accounting,
-- then evaluate share/post display flags only for rows that survive visibility
-- and the requested limit.
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
  appearance jsonb,
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
  with flow_rows as materialized (
    select
      f.*,
      sc.is_personal as calendar_is_personal,
      fsaves.saved_at as flow_saved_at,
      (coalesce(f.is_saved, false) or fsaves.flow_id is not null)
        as filed_is_saved
    from public.flows f
    join public.shared_calendars sc
      on sc.id = f.calendar_id
     and sc.deleted_at is null
    join public.shared_calendar_members scm
      on scm.calendar_id = f.calendar_id
     and scm.user_id = v_uid
     and scm.status = 'accepted'
    left join public.flow_saves fsaves
      on fsaves.flow_id = f.id
     and fsaves.user_id = v_uid
    where f.user_id = v_uid
      and coalesce(f.is_hidden, false) = false
      and coalesce(f.is_reminder, false) = false
      and public.flow_has_repeating_note_metadata(f.notes) = false
      and (
        coalesce(f.is_saved, false)
        or fsaves.flow_id is not null
        or (
          coalesce(f.active, false) = true
          and public.flow_is_schedule_open(
            f.end_date,
            v_timezone,
            v_now
          )
        )
      )
  ),
  flow_ids as materialized (
    select coalesce(
      array_agg(f.id order by f.id),
      array[]::bigint[]
    )::bigint[] as ids
    from flow_rows f
  ),
  activity as materialized (
    select summary.*
    from flow_ids
    cross join lateral private.flow_activity_summary_v1(
      v_uid,
      flow_ids.ids
    ) summary
    where cardinality(flow_ids.ids) > 0
  ),
  selected_flows as materialized (
    select
      f.*,
      activity.is_counted_active as accounted_is_counted_active,
      activity.total_event_count as accounted_total_event_count,
      activity.remaining_event_count as accounted_remaining_event_count,
      activity.remaining_live_event_count
        as accounted_remaining_live_event_count
    from flow_rows f
    join activity on activity.flow_id = f.id
    where activity.is_counted_active or f.filed_is_saved
    order by f.created_at desc
    limit p_limit
  ),
  social_flags as materialized (
    select
      f.id as flow_id,
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
    from selected_flows f
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
    f.appearance,
    coalesce(f.is_hidden, false) as is_hidden,
    coalesce(f.is_reminder, false) as is_reminder,
    f.reminder_uuid,
    f.share_id,
    f.origin_share_id,
    f.created_at,
    f.updated_at,
    f.flow_saved_at as saved_at,
    case
      when f.accounted_is_counted_active then 'active'
      else 'inactive'
    end,
    f.accounted_is_counted_active as visible_in_active_list,
    f.filed_is_saved as visible_in_saved_list,
    f.accounted_total_event_count,
    f.accounted_remaining_event_count,
    f.accounted_remaining_live_event_count,
    (
      coalesce(f.calendar_is_personal, true) = false
      or social.has_flow_share
    ) as is_shared,
    social.has_flow_post as is_posted,
    (coalesce(f.calendar_is_personal, true) = false)
      as is_shared_calendar_source,
    social.has_flow_share as is_flow_share_source
  from selected_flows f
  join social_flags social
    on social.flow_id = f.id
  order by f.created_at desc;
end;
$$;

revoke all on function public.get_my_filed_flows_v1(integer) from public;
revoke all on function public.get_my_filed_flows_v1(integer) from anon;
grant execute on function public.get_my_filed_flows_v1(integer)
  to authenticated;

comment on function public.get_my_filed_flows_v1(integer) is
  'Single bounded My Flows list authority. Candidate filtering precedes canonical event accounting; social display flags are evaluated only for visible limited rows.';

notify pgrst, 'reload schema';

commit;
