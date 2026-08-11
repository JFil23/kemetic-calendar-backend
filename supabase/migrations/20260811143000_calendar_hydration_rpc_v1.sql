create index if not exists user_events_flow_local_id_starts_at_idx
  on public.user_events (flow_local_id, starts_at);

create or replace function public.get_calendar_hydration_events_v1(
  p_start_utc timestamptz,
  p_end_utc timestamptz,
  p_lane text,
  p_flow_ids bigint[] default null,
  p_page_limit integer default 1000,
  p_page_offset integer default 0
)
returns table (
  id uuid,
  calendar_id uuid,
  calendar_name text,
  calendar_color bigint,
  calendar_is_personal boolean,
  client_event_id text,
  title text,
  detail text,
  location text,
  all_day boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  flow_local_id bigint,
  filed_flow_id bigint,
  item_kind text,
  category text,
  action_id text,
  behavior_payload jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lane text := lower(btrim(coalesce(p_lane, '')));
  v_page_limit integer := least(greatest(coalesce(p_page_limit, 1000), 1), 2000);
  v_page_offset integer := greatest(coalesce(p_page_offset, 0), 0);
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if v_lane not in ('flow', 'standalone') then
    raise exception 'invalid hydration lane';
  end if;

  if p_start_utc is null
    or p_end_utc is null
    or p_end_utc <= p_start_utc then
    raise exception 'invalid hydration window';
  end if;

  return query
  with
  visible_calendars as materialized (
    select scm.calendar_id
    from public.shared_calendar_members scm
    where scm.user_id = v_uid
      and scm.status in ('pending', 'accepted')
  ),
  visible_shared_calendars as materialized (
    select scm.calendar_id
    from public.shared_calendar_members scm
    where scm.user_id = v_uid
      and scm.status = 'accepted'
  ),
  visible_shared_flows as materialized (
    select fs.flow_id
    from public.flow_shares fs
    where fs.sender_id = v_uid
    union
    select fs.flow_id
    from public.flow_shares fs
    where fs.recipient_id = v_uid
  ),
  visible_shared_events as materialized (
    select es.event_id
    from public.event_shares es
    where es.sender_id = v_uid
    union
    select es.event_id
    from public.event_shares es
    where es.recipient_id = v_uid
  ),
  candidate_ids as materialized (
    select ue.id
    from public.user_events ue
    where ue.user_id = v_uid
      and ue.starts_at >= p_start_utc
      and ue.starts_at < p_end_utc

    union

    select ue.id
    from visible_shared_calendars vsc
    join public.user_events ue
      on ue.calendar_id = vsc.calendar_id
    where ue.starts_at >= p_start_utc
      and ue.starts_at < p_end_utc

    union

    select ue.id
    from visible_shared_flows vsf
    join public.user_events ue
      on ue.flow_local_id = vsf.flow_id
    where ue.starts_at >= p_start_utc
      and ue.starts_at < p_end_utc

    union

    select ue.id
    from visible_shared_events vse
    join public.user_events ue
      on ue.id = vse.event_id
    where ue.starts_at >= p_start_utc
      and ue.starts_at < p_end_utc
  ),
  visible_events as materialized (
    select
      ue.id,
      ue.user_id,
      ue.calendar_id,
      sc.name as calendar_name,
      sc.color as calendar_color,
      sc.is_personal as calendar_is_personal,
      ue.client_event_id,
      ue.title,
      ue.detail,
      ue.location,
      ue.all_day,
      ue.starts_at,
      ue.ends_at,
      ue.flow_local_id::bigint as raw_flow_local_id,
      ue.category,
      ue.action_id,
      ue.behavior_payload,
      public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      ) as referenced_flow_id
    from candidate_ids ci
    join public.user_events ue
      on ue.id = ci.id
    join public.shared_calendars sc
      on sc.id = ue.calendar_id
     and sc.deleted_at is null
    join visible_calendars vc
      on vc.calendar_id = sc.id
  ),
  unresolved_actions as materialized (
    select distinct
      ve.user_id,
      btrim(ve.action_id) as action_id
    from visible_events ve
    where ve.referenced_flow_id is null
      and nullif(btrim(coalesce(ve.action_id, '')), '') is not null
  ),
  action_flow_matches as materialized (
    select distinct on (ua.user_id, ua.action_id)
      ua.user_id,
      ua.action_id,
      f.id as flow_id
    from unresolved_actions ua
    join public.flows f
      on f.user_id = ua.user_id
     and public.flow_metadata_has_action_id(f.ai_metadata, ua.action_id)
    order by
      ua.user_id,
      ua.action_id,
      case public.flow_record_kind(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      )
        when 'active' then 0
        when 'inactive' then 1
        else 2
      end,
      f.updated_at desc nulls last,
      f.id desc
  ),
  filed as materialized (
    select
      ve.*,
      coalesce(ve.referenced_flow_id, afm.flow_id) as canonical_flow_id
    from visible_events ve
    left join action_flow_matches afm
      on afm.user_id = ve.user_id
     and afm.action_id = btrim(ve.action_id)
  ),
  classified as materialized (
    select
      filed.*,
      f.id as joined_flow_id,
      f.active as flow_active,
      f.is_hidden as flow_is_hidden,
      f.is_reminder as flow_is_reminder,
      f.notes as flow_notes,
      case
        when lower(coalesce(filed.client_event_id, '')) like 'reminder:%'
          or lower(coalesce(filed.client_event_id, '')) like 'nutrition:%'
          or coalesce(f.is_reminder, false)
          then 'reminder'
        when filed.canonical_flow_id is not null
          or lower(coalesce(filed.client_event_id, '')) like 'maat:%'
          then 'flow'
        else 'note'
      end as computed_item_kind,
      public.user_event_reminder_uuid(filed.client_event_id) as reminder_uuid,
      public.user_event_reminder_occurrence_date(
        filed.client_event_id
      ) as reminder_occurrence_date
    from filed
    left join public.flows f
      on f.id = filed.canonical_flow_id
  ),
  active_tombstones as materialized (
    select
      edt.user_id,
      edt.client_event_id
    from public.event_deletion_trash edt
    where edt.purged_at is null
      and edt.purge_after > timezone('utc', now())
      and edt.suppresses_client = true
  ),
  tombstoned_event_ids as materialized (
    select distinct c.id
    from classified c
    join active_tombstones at
      on at.user_id = c.user_id
     and at.client_event_id = any(array_remove(array[
       c.client_event_id,
       case
         when c.reminder_uuid is null then null
         else 'reminder:' || c.reminder_uuid::text
       end,
       case
         when c.reminder_uuid is null then null
         else 'reminder:rule:' || c.reminder_uuid::text
       end
     ], null))
  ),
  active_reminder_flow_event_ids as materialized (
    select distinct c.id
    from classified c
    join public.flows rf
      on rf.user_id = c.user_id
     and rf.reminder_uuid = c.reminder_uuid
     and rf.is_reminder = true
     and rf.active = true
     and coalesce(rf.is_hidden, false) = false
     and public.flow_is_deleted_state(
       rf.active,
       coalesce(rf.is_hidden, false),
       rf.notes
     ) = false
    cross join lateral (
      select public.try_parse_jsonb(rf.notes) as rule_json
    ) parsed
    where c.reminder_uuid is not null
      and (
        c.reminder_occurrence_date is null
        or (
          c.reminder_occurrence_date >= coalesce(
            rf.start_date,
            case
              when coalesce(parsed.rule_json ->> 'startLocal', '') ~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                then ((parsed.rule_json ->> 'startLocal')::timestamp)::date
              else c.reminder_occurrence_date
            end,
            c.reminder_occurrence_date
          )
          and c.reminder_occurrence_date <= coalesce(
            rf.end_date,
            case
              when coalesce(parsed.rule_json ->> 'endLocal', '') ~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                then ((parsed.rule_json ->> 'endLocal')::timestamp)::date
              else c.reminder_occurrence_date
            end,
            c.reminder_occurrence_date
          )
        )
      )
  ),
  supported_reminder_event_ids as materialized (
    select arf.id
    from active_reminder_flow_event_ids arf

    union

    select c.id
    from classified c
    join public.reminders r
      on r.user_id = c.user_id
     and r.id = c.reminder_uuid
    where c.reminder_uuid is not null

    union

    select c.id
    from classified c
    join public.scheduled_notifications sn
      on sn.user_id = c.user_id
     and sn.client_event_id = c.client_event_id
     and sn.is_active = true
    where c.reminder_uuid is not null
  ),
  publishable as materialized (
    select c.*
    from classified c
    left join tombstoned_event_ids tei
      on tei.id = c.id
    left join supported_reminder_event_ids sri
      on sri.id = c.id
    where tei.id is null
      and lower(coalesce(c.category, '')) <> 'tombstone'
      and lower(coalesce(c.client_event_id, '')) not like 'reminder:tombstone:%'
      and lower(coalesce(c.client_event_id, '')) not like 'maat:%'
      and (
        c.canonical_flow_id is null
        or (
          c.joined_flow_id is not null
          and public.flow_is_deleted_state(
            c.flow_active,
            c.flow_is_hidden,
            c.flow_notes
          ) = false
        )
      )
      and (c.reminder_uuid is null or sri.id is not null)
  )
  select
    p.id,
    p.calendar_id,
    p.calendar_name,
    p.calendar_color,
    p.calendar_is_personal,
    p.client_event_id,
    p.title,
    p.detail,
    p.location,
    p.all_day,
    p.starts_at,
    p.ends_at,
    p.raw_flow_local_id as flow_local_id,
    p.canonical_flow_id as filed_flow_id,
    p.computed_item_kind as item_kind,
    p.category,
    p.action_id,
    p.behavior_payload
  from publishable p
  where (
      v_lane = 'flow'
      and p.computed_item_kind = 'flow'
      and p.canonical_flow_id = any(coalesce(p_flow_ids, '{}'::bigint[]))
    )
    or (
      v_lane = 'standalone'
      and p.computed_item_kind in ('note', 'reminder')
    )
  order by
    case when v_lane = 'flow' then p.canonical_flow_id end,
    p.starts_at,
    p.id
  limit v_page_limit
  offset v_page_offset;
end;
$$;

comment on function public.get_calendar_hydration_events_v1(
  timestamptz,
  timestamptz,
  text,
  bigint[],
  integer,
  integer
) is
'Versioned calendar hydration read. Resolves visibility in indexed set-based lanes, classifies and suppresses deleted rows without the filing view, and pages a complete flow or standalone lane.';

revoke all on function public.get_calendar_hydration_events_v1(
  timestamptz,
  timestamptz,
  text,
  bigint[],
  integer,
  integer
) from public;
revoke all on function public.get_calendar_hydration_events_v1(
  timestamptz,
  timestamptz,
  text,
  bigint[],
  integer,
  integer
) from anon;
grant execute on function public.get_calendar_hydration_events_v1(
  timestamptz,
  timestamptz,
  text,
  bigint[],
  integer,
  integer
) to authenticated;

notify pgrst, 'reload schema';
