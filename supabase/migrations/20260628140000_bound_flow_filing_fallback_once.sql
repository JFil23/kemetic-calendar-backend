create or replace view public.flow_filing_items_client
with (security_invoker = true) as
with flow_sources as (
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
fallback_event_refs as (
  select
    coalesce(
      public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      ),
      public.flow_id_from_action_id(ue.user_id, ue.action_id)
    ) as flow_id,
    ue.user_id,
    ue.client_event_id,
    ue.all_day,
    ue.starts_at,
    ue.ends_at,
    ue.category
  from public.user_events ue
  where ue.user_id = auth.uid()
    and ue.flow_local_id is null
),
event_source as (
  select
    fs.id as flow_id,
    fs.active as flow_active,
    fs.is_hidden as flow_is_hidden,
    fs.notes as flow_notes,
    ue.user_id,
    ue.client_event_id,
    ue.all_day,
    ue.starts_at,
    ue.ends_at,
    ue.category
  from flow_sources fs
  join public.user_events ue
    on ue.user_id = fs.user_id
   and ue.flow_local_id = fs.id

  union all

  select
    fs.id as flow_id,
    fs.active as flow_active,
    fs.is_hidden as flow_is_hidden,
    fs.notes as flow_notes,
    fer.user_id,
    fer.client_event_id,
    fer.all_day,
    fer.starts_at,
    fer.ends_at,
    fer.category
  from flow_sources fs
  join fallback_event_refs fer
    on fer.flow_id = fs.id
),
event_rows as (
  select
    es.flow_id,
    es.user_id,
    es.client_event_id,
    public.user_event_date_lifecycle(
      es.user_id,
      es.all_day,
      es.starts_at,
      es.ends_at
    ) as date_lifecycle,
    (
      lower(coalesce(es.category, '')) = 'tombstone'
      or lower(coalesce(es.client_event_id, '')) like 'reminder:tombstone:%'
      or lower(coalesce(es.client_event_id, '')) like 'maat:%'
      or public.user_event_has_suppressing_tombstone(
        es.user_id,
        es.client_event_id
      )
      or public.flow_is_deleted_state(
        es.flow_active,
        es.flow_is_hidden,
        es.flow_notes
      )
    ) as is_deleted,
    uec.id as completion_id
  from event_source es
  left join public.user_event_completions uec
    on uec.user_id = es.user_id
   and uec.flow_id = es.flow_id
   and uec.client_event_id = es.client_event_id
),
event_counts as (
  select
    er.flow_id,
    count(*) filter (where not er.is_deleted) as total_event_count,
    count(*) filter (
      where not er.is_deleted
        and er.date_lifecycle = 'active'
    ) as live_event_count,
    count(*) filter (
      where not er.is_deleted
        and er.date_lifecycle = 'inactive'
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
        and er.date_lifecycle = 'active'
        and (
          er.client_event_id is null
          or btrim(er.client_event_id) = ''
          or er.completion_id is null
        )
    ) as remaining_live_event_count
  from event_rows er
  group by er.flow_id
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
'Client-safe flow-level filing view. Flow event counts use indexed flow_local_id rows first and derive fallback flow references once per null-flow event.';
notify pgrst, 'reload schema';
