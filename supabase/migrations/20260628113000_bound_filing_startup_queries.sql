create or replace view public.flow_filing_items_client
with (security_invoker = true) as
with event_counts as (
  select
    e.filed_flow_id as flow_id,
    count(*) as total_event_count,
    count(*) filter (where e.live_on_calendar) as live_event_count,
    count(*) filter (where e.lifecycle = 'inactive') as inactive_event_count,
    count(*) filter (where uec.id is not null) as completed_event_count,
    count(*) filter (
      where e.client_event_id is null
        or btrim(e.client_event_id) = ''
        or uec.id is null
    ) as remaining_event_count,
    count(*) filter (
      where e.live_on_calendar
        and (
          e.client_event_id is null
          or btrim(e.client_event_id) = ''
          or uec.id is null
        )
    ) as remaining_live_event_count
  from public.user_event_filing_items_client e
  left join public.user_event_completions uec
    on uec.user_id = e.user_id
   and uec.flow_id = e.filed_flow_id
   and uec.client_event_id = e.client_event_id
  where e.user_id = auth.uid()
    and e.filed_flow_id is not null
  group by e.filed_flow_id
),
flow_sources as (
  select
    f.id,
    f.user_id,
    f.calendar_id,
    sc.name as calendar_name,
    sc.color as calendar_color,
    sc.is_personal as calendar_is_personal,
    f.name,
    f.color,
    f.active,
    (
      coalesce(f.is_saved, false)
      or fsaves.flow_id is not null
    ) as is_saved,
    f.start_date,
    f.end_date,
    f.notes,
    f.rules,
    f.ai_metadata,
    f.is_hidden,
    f.share_id,
    f.created_at,
    f.updated_at,
    f.is_reminder,
    f.reminder_uuid,
    f.origin_type,
    f.origin_flow_id,
    f.origin_share_id,
    f.origin_generation_id,
    f.root_flow_id,
    fsaves.saved_at,
    coalesce(nullif(public._get_user_timezone(f.user_id), ''), 'UTC') as user_timezone,
    public.flow_record_kind(
      f.active,
      f.is_hidden,
      f.is_reminder,
      f.notes
    ) as flow_record_kind,
    public.flow_is_schedule_open(
      f.end_date,
      public._get_user_timezone(f.user_id)
    ) as schedule_open,
    public.flow_is_deleted_state(
      f.active,
      f.is_hidden,
      f.notes
    ) as is_deleted,
    exists (
      select 1
      from public.flow_shares fshare
      where fshare.flow_id = f.id
        and fshare.deleted_at is null
        and coalesce(fshare.status, 'pending') in ('sent', 'viewed', 'imported', 'public')
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
   and fsaves.user_id = auth.uid()
  where f.user_id = auth.uid()
    and exists (
      select 1
      from public.shared_calendar_members scm
      where scm.calendar_id = f.calendar_id
        and scm.user_id = auth.uid()
        and scm.status = 'accepted'
    )
),
classified as (
  select
    fs.*,
    coalesce(ec.total_event_count, 0) as total_event_count,
    coalesce(ec.live_event_count, 0) as live_event_count,
    coalesce(ec.inactive_event_count, 0) as inactive_event_count,
    coalesce(ec.completed_event_count, 0) as completed_event_count,
    coalesce(ec.remaining_event_count, 0) as remaining_event_count,
    coalesce(ec.remaining_live_event_count, 0) as remaining_live_event_count,
    case
      when coalesce(fs.is_reminder, false) then 'reminder'
      else 'flow'
    end as item_kind,
    case
      when coalesce(fs.is_reminder, false) then 'flow_is_reminder'
      when fs.flow_record_kind = 'hiddenHelper' then 'repeating_note_helper'
      else 'flow_row'
    end as reason_item_kind,
    case
      when fs.is_deleted then 'flow_deleted_state'
      else null
    end as reason_deleted,
    case
      when fs.is_deleted then 'deleted_flow'
      when coalesce(fs.is_reminder, false) then 'reminder_backed_flow'
      when fs.flow_record_kind = 'hiddenHelper' then 'repeating_note_helper'
      when coalesce(fs.active, false) = false then 'flow_inactive'
      when fs.schedule_open = false then 'schedule_closed'
      when coalesce(ec.remaining_live_event_count, 0) <= 0 then 'no_live_events'
      else 'active_with_live_events'
    end as reason_lifecycle,
    case
      when fs.is_deleted then 'deleted'
      when coalesce(fs.is_reminder, false) then 'inactive'
      when fs.flow_record_kind = 'hiddenHelper' then 'inactive'
      when coalesce(fs.active, false) = false then 'inactive'
      when fs.schedule_open = false then 'inactive'
      when coalesce(ec.remaining_live_event_count, 0) <= 0 then 'inactive'
      else 'active'
    end as lifecycle,
    (fs.calendar_is_personal = false) as is_shared_calendar_source,
    fs.has_flow_share as is_flow_share_source,
    fs.has_flow_post as is_flow_post_source,
    coalesce(fs.is_saved, false) as is_flow_saved_source
  from flow_sources fs
  left join event_counts ec
    on ec.flow_id = fs.id
)
select
  classified.*,
  (classified.lifecycle = 'active') as live_on_calendar,
  (classified.lifecycle = 'active') as is_counted_active,
  (
    classified.lifecycle = 'active'
    and classified.item_kind = 'flow'
  ) as visible_in_active_list,
  (
    coalesce(classified.is_saved, false)
    and classified.item_kind = 'flow'
    and classified.lifecycle <> 'deleted'
    and classified.flow_record_kind in ('active', 'inactive')
  ) as visible_in_saved_list,
  (
    classified.is_shared_calendar_source
    or classified.is_flow_share_source
  ) as is_shared,
  classified.is_flow_post_source as is_posted,
  jsonb_build_object(
    'item_kind', jsonb_build_object(
      'value', classified.item_kind,
      'reason', classified.reason_item_kind,
      'flow_record_kind', classified.flow_record_kind
    ),
    'lifecycle', jsonb_build_object(
      'value', classified.lifecycle,
      'reason', classified.reason_lifecycle,
      'deleted_reason', classified.reason_deleted,
      'schedule_open', classified.schedule_open,
      'timezone', classified.user_timezone,
      'remaining_live_event_count', classified.remaining_live_event_count
    ),
    'calendar', jsonb_build_object(
      'calendar_id', classified.calendar_id,
      'calendar_name', classified.calendar_name,
      'calendar_is_personal', classified.calendar_is_personal,
      'live_on_calendar', classified.lifecycle = 'active'
    ),
    'event_counts', jsonb_build_object(
      'total', classified.total_event_count,
      'live', classified.live_event_count,
      'inactive', classified.inactive_event_count,
      'completed', classified.completed_event_count,
      'remaining', classified.remaining_event_count,
      'remaining_live', classified.remaining_live_event_count
    ),
    'share_sources', jsonb_build_object(
      'shared_calendar', classified.is_shared_calendar_source,
      'flow_share', classified.is_flow_share_source
    ),
    'post_sources', jsonb_build_object(
      'flow_post', classified.is_flow_post_source
    ),
    'save_sources', jsonb_build_object(
      'flow_saved', classified.is_flow_saved_source
    )
  ) as filing_reasons
from classified
where classified.lifecycle <> 'deleted';
revoke all on public.flow_filing_items_client from public;
revoke all on public.flow_filing_items_client from anon;
revoke all on public.flow_filing_items_client from authenticated;
grant select on public.flow_filing_items_client to authenticated;
grant select on public.flow_filing_items_client to service_role;
comment on view public.flow_filing_items_client is
'Client-safe flow-level filing view. Lifecycle and counts are derived from user-scoped user_event_filing_items_client rows so My Flows and profile accounting share calendar-live event rules without global event aggregation.';
comment on function public.get_my_flow_activity() is
'Authenticated flow accountant backed by flow_filing_items_client. remaining_event_count is the count of live, not-completed, client-safe filed events.';
create or replace view public.shared_calendar_filing_items_client
with (security_invoker = true)
as
with accepted_calendars as (
  select
    scm.calendar_id,
    scm.user_id,
    scm.role,
    scm.status
  from public.shared_calendar_members scm
  where scm.user_id = auth.uid()
    and scm.status = 'accepted'
),
calendar_event_counts as (
  select
    e.calendar_id,
    count(*) as total_event_count,
    count(*) filter (where e.live_on_calendar) as live_event_count,
    count(*) filter (where e.lifecycle = 'inactive') as inactive_event_count,
    count(distinct e.filed_flow_id) filter (
      where e.filed_flow_id is not null and e.live_on_calendar
    ) as live_flow_count
  from public.user_event_filing_items_client e
  join accepted_calendars ac
    on ac.calendar_id = e.calendar_id
  where e.calendar_id is not null
  group by e.calendar_id
)
select
  sc.id,
  sc.owner_id,
  sc.name,
  sc.color,
  sc.icon,
  sc.is_personal,
  sc.created_at,
  sc.updated_at,
  ac.user_id as member_user_id,
  ac.role,
  ac.status,
  owner_profile.handle as owner_handle,
  owner_profile.display_name as owner_display_name,
  (
    select count(*)::integer
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'accepted'
  ) as member_count,
  case
    when sc.owner_id = auth.uid() then (
      select count(*)::integer
      from public.shared_calendar_members inner_scm
      where inner_scm.calendar_id = sc.id
        and inner_scm.status = 'pending'
    )
    else 0
  end as pending_invite_count,
  coalesce(cec.total_event_count, 0::bigint) as total_event_count,
  coalesce(cec.live_event_count, 0::bigint) as live_event_count,
  coalesce(cec.inactive_event_count, 0::bigint) as inactive_event_count,
  coalesce(cec.live_flow_count, 0::bigint) as live_flow_count,
  'shared_calendar'::text as item_kind,
  case
    when sc.deleted_at is not null then 'deleted'::text
    when ac.status = 'accepted' then 'active'::text
    else ac.status
  end as lifecycle,
  (ac.status = 'accepted' and sc.deleted_at is null) as live_on_calendar,
  (sc.is_personal = false) as is_shared,
  jsonb_build_object(
    'item_kind', 'shared_calendar',
    'system_type', sc.system_type,
    'lifecycle', case
      when sc.deleted_at is not null then 'deleted'::text
      when ac.status = 'accepted' then 'active'::text
      else ac.status
    end,
    'membership', jsonb_build_object(
      'role', ac.role,
      'status', ac.status,
      'member_user_id', ac.user_id,
      'owner_id', sc.owner_id
    ),
    'event_counts', jsonb_build_object(
      'total', coalesce(cec.total_event_count, 0::bigint),
      'live', coalesce(cec.live_event_count, 0::bigint),
      'inactive', coalesce(cec.inactive_event_count, 0::bigint),
      'live_flows', coalesce(cec.live_flow_count, 0::bigint)
    )
  ) as filing_reasons,
  sc.system_type
from accepted_calendars ac
join public.shared_calendars sc
  on sc.id = ac.calendar_id
left join public.profiles owner_profile
  on owner_profile.id = sc.owner_id
left join calendar_event_counts cec
  on cec.calendar_id = sc.id
where sc.deleted_at is null;
revoke all on public.shared_calendar_filing_items_client from public;
revoke all on public.shared_calendar_filing_items_client from anon;
revoke all on public.shared_calendar_filing_items_client from authenticated;
grant select on public.shared_calendar_filing_items_client to authenticated;
grant select on public.shared_calendar_filing_items_client to service_role;
comment on view public.shared_calendar_filing_items_client is
'Client-safe filing view for accepted calendars. Pending invite counts are owner-only; event counts are derived from accepted-calendar-scoped user_event_filing_items_client rows.';
notify pgrst, 'reload schema';
