create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to service_role;

drop view if exists public.user_event_filing_items;
drop view if exists public.user_event_filing_items_client cascade;
drop view if exists private.user_event_filing_items_internal cascade;

create view private.user_event_filing_items_internal
with (security_invoker = true) as
with filed as (
  select
    ue.id,
    ue.user_id,
    ue.client_event_id,
    ue.calendar_id,
    sc.name as calendar_name,
    sc.color as calendar_color,
    sc.is_personal as calendar_is_personal,
    ue.title,
    ue.detail,
    ue.location,
    ue.all_day,
    ue.starts_at,
    ue.ends_at,
    ue.flow_local_id,
    ue.category,
    ue.action_id,
    ue.behavior_payload,
    ue.updated_at,
    ue.created_at,
    ref.flow_id as filed_flow_id,
    f.active as flow_active,
    f.is_hidden as flow_is_hidden,
    f.is_reminder as flow_is_reminder,
    f.is_saved as flow_is_saved,
    f.notes as flow_notes,
    coalesce(nullif(public._get_user_timezone(ue.user_id), ''), 'UTC') as user_timezone,
    public.user_event_active_until(
      ue.user_id,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    ) as active_until,
    public.user_event_date_lifecycle(
      ue.user_id,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    ) as date_lifecycle,
    exists (
      select 1
      from public.event_shares es
      where es.event_id = ue.id
        and es.deleted_at is null
        and coalesce(es.status, 'pending') in ('sent', 'viewed', 'imported', 'public')
    ) as has_event_share,
    exists (
      select 1
      from public.flow_shares fs
      where fs.flow_id = ref.flow_id
        and fs.deleted_at is null
        and coalesce(fs.status, 'pending') in ('sent', 'viewed', 'imported', 'public')
    ) as has_flow_share,
    exists (
      select 1
      from public.flow_posts fp
      where fp.flow_id = ref.flow_id
        and coalesce(fp.is_hidden, false) = false
    ) as has_flow_post,
    exists (
      select 1
      from public.reminders r
      where r.user_id = ue.user_id
        and coalesce(r.status, 'pending') <> 'completed'
        and (r.event_id = ue.id or r.flow_event_id = ue.id)
    ) as has_active_reminder,
    exists (
      select 1
      from public.scheduled_notifications sn
      where sn.user_id = ue.user_id
        and sn.is_active = true
        and ue.client_event_id is not null
        and sn.client_event_id = ue.client_event_id
    ) as has_scheduled_notification
  from public.user_events ue
  join public.shared_calendars sc
    on sc.id = ue.calendar_id
   and sc.deleted_at is null
  left join lateral (
    select coalesce(
      public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      ),
      public.flow_id_from_action_id(ue.user_id, ue.action_id)
    ) as flow_id
  ) ref on true
  left join public.flows f
    on f.id = ref.flow_id
),
reasoned as (
  select
    filed.*,
    case
      when lower(coalesce(filed.client_event_id, '')) like 'reminder:%'
        then 'client_event_id_reminder_prefix'
      when lower(coalesce(filed.client_event_id, '')) like 'nutrition:%'
        then 'client_event_id_nutrition_prefix'
      when coalesce(filed.flow_is_reminder, false)
        then 'flow_is_reminder'
      when filed.filed_flow_id is not null
        then 'flow_reference'
      when lower(coalesce(filed.client_event_id, '')) like 'maat:%'
        then 'legacy_maat_prefix'
      else 'standalone_event'
    end as reason_item_kind,
    case
      when lower(coalesce(filed.category, '')) = 'tombstone'
        then 'category_tombstone'
      when lower(coalesce(filed.client_event_id, '')) like 'reminder:tombstone:%'
        then 'reminder_tombstone'
      when lower(coalesce(filed.client_event_id, '')) like 'maat:%'
        then 'legacy_maat_event'
      when public.user_event_recently_deleted(filed.user_id, filed.client_event_id)
        then 'event_deletion_trash'
      when filed.filed_flow_id is not null and filed.flow_active is null
        then 'orphaned_flow_reference'
      when filed.filed_flow_id is not null
        and public.flow_is_deleted_state(
          filed.flow_active,
          filed.flow_is_hidden,
          filed.flow_notes
        )
        then 'deleted_flow'
      else null
    end as reason_deleted,
    case
      when coalesce(filed.all_day, false)
        and filed.ends_at is not null
        and filed.ends_at > filed.starts_at
        then 'all_day_valid_ends_at'
      when coalesce(filed.all_day, false)
        then 'all_day_local_day_end'
      when filed.ends_at is not null
        and filed.ends_at > filed.starts_at
        then 'timed_valid_ends_at'
      else 'starts_at'
    end as reason_active_until
  from filed
),
classified as (
  select
    reasoned.*,
    case
      when lower(coalesce(reasoned.client_event_id, '')) like 'reminder:%'
        or lower(coalesce(reasoned.client_event_id, '')) like 'nutrition:%'
        or coalesce(reasoned.flow_is_reminder, false) then 'reminder'
      when reasoned.filed_flow_id is not null
        or lower(coalesce(reasoned.client_event_id, '')) like 'maat:%' then 'flow'
      else 'note'
    end as item_kind,
    (reasoned.reason_deleted is not null) as is_deleted,
    coalesce(reasoned.flow_is_saved, false) as is_saved,
    (reasoned.calendar_is_personal = false) as is_shared_calendar_source,
    reasoned.has_event_share as is_event_share_source,
    reasoned.has_flow_share as is_flow_share_source,
    reasoned.has_flow_post as is_flow_post_source,
    coalesce(reasoned.flow_is_saved, false) as is_flow_saved_source,
    reasoned.has_active_reminder as is_active_reminder_source,
    reasoned.has_scheduled_notification as is_scheduled_notification_source
  from reasoned
),
projected as (
  select
    classified.*,
    case
      when classified.is_deleted then 'deleted'
      else classified.date_lifecycle
    end as lifecycle,
    (
      classified.is_deleted = false
      and classified.date_lifecycle = 'active'
    ) as live_on_calendar,
    (
      classified.is_shared_calendar_source
      or classified.is_event_share_source
      or classified.is_flow_share_source
    ) as is_shared,
    classified.is_flow_post_source as is_posted
  from classified
)
select
  projected.*,
  jsonb_build_object(
    'item_kind', jsonb_build_object(
      'value', projected.item_kind,
      'reason', projected.reason_item_kind
    ),
    'lifecycle', jsonb_build_object(
      'value', projected.lifecycle,
      'date_lifecycle', projected.date_lifecycle,
      'deleted_reason', projected.reason_deleted,
      'active_until', projected.active_until,
      'active_until_reason', projected.reason_active_until,
      'timezone', projected.user_timezone
    ),
    'calendar', jsonb_build_object(
      'calendar_id', projected.calendar_id,
      'calendar_name', projected.calendar_name,
      'calendar_is_personal', projected.calendar_is_personal,
      'live_on_calendar', projected.live_on_calendar
    ),
    'share_sources', jsonb_build_object(
      'shared_calendar', projected.is_shared_calendar_source,
      'event_share', projected.is_event_share_source,
      'flow_share', projected.is_flow_share_source
    ),
    'post_sources', jsonb_build_object(
      'flow_post', projected.is_flow_post_source
    ),
    'save_sources', jsonb_build_object(
      'flow_saved', projected.is_flow_saved_source
    ),
    'reminder_sources', jsonb_build_object(
      'active_reminder', projected.is_active_reminder_source,
      'scheduled_notification', projected.is_scheduled_notification_source
    )
  ) as filing_reasons
from projected;

create view public.user_event_filing_items_client
with (security_invoker = true) as
with filed as (
  select
    ue.id,
    ue.user_id,
    ue.client_event_id,
    ue.calendar_id,
    sc.name as calendar_name,
    sc.color as calendar_color,
    sc.is_personal as calendar_is_personal,
    ue.title,
    ue.detail,
    ue.location,
    ue.all_day,
    ue.starts_at,
    ue.ends_at,
    ue.flow_local_id,
    ue.category,
    ue.action_id,
    ue.behavior_payload,
    ue.updated_at,
    ue.created_at,
    ref.flow_id as filed_flow_id,
    f.active as flow_active,
    f.is_hidden as flow_is_hidden,
    f.is_reminder as flow_is_reminder,
    f.is_saved as flow_is_saved,
    f.notes as flow_notes,
    coalesce(nullif(public._get_user_timezone(ue.user_id), ''), 'UTC') as user_timezone,
    public.user_event_active_until(
      ue.user_id,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    ) as active_until,
    public.user_event_date_lifecycle(
      ue.user_id,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    ) as date_lifecycle,
    exists (
      select 1
      from public.event_shares es
      where es.event_id = ue.id
        and es.deleted_at is null
        and coalesce(es.status, 'pending') in ('sent', 'viewed', 'imported', 'public')
    ) as has_event_share,
    exists (
      select 1
      from public.flow_shares fs
      where fs.flow_id = ref.flow_id
        and fs.deleted_at is null
        and coalesce(fs.status, 'pending') in ('sent', 'viewed', 'imported', 'public')
    ) as has_flow_share,
    exists (
      select 1
      from public.flow_posts fp
      where fp.flow_id = ref.flow_id
        and coalesce(fp.is_hidden, false) = false
    ) as has_flow_post,
    exists (
      select 1
      from public.reminders r
      where r.user_id = ue.user_id
        and coalesce(r.status, 'pending') <> 'completed'
        and (r.event_id = ue.id or r.flow_event_id = ue.id)
    ) as has_active_reminder,
    exists (
      select 1
      from public.scheduled_notifications sn
      where sn.user_id = ue.user_id
        and sn.is_active = true
        and ue.client_event_id is not null
        and sn.client_event_id = ue.client_event_id
    ) as has_scheduled_notification
  from public.user_events ue
  join public.shared_calendars sc
    on sc.id = ue.calendar_id
   and sc.deleted_at is null
  left join lateral (
    select coalesce(
      public.user_event_referenced_flow_id(
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail
      ),
      public.flow_id_from_action_id(ue.user_id, ue.action_id)
    ) as flow_id
  ) ref on true
  left join public.flows f
    on f.id = ref.flow_id
),
reasoned as (
  select
    filed.*,
    case
      when lower(coalesce(filed.client_event_id, '')) like 'reminder:%'
        then 'client_event_id_reminder_prefix'
      when lower(coalesce(filed.client_event_id, '')) like 'nutrition:%'
        then 'client_event_id_nutrition_prefix'
      when coalesce(filed.flow_is_reminder, false)
        then 'flow_is_reminder'
      when filed.filed_flow_id is not null
        then 'flow_reference'
      when lower(coalesce(filed.client_event_id, '')) like 'maat:%'
        then 'legacy_maat_prefix'
      else 'standalone_event'
    end as reason_item_kind,
    case
      when lower(coalesce(filed.category, '')) = 'tombstone'
        then 'category_tombstone'
      when lower(coalesce(filed.client_event_id, '')) like 'reminder:tombstone:%'
        then 'reminder_tombstone'
      when lower(coalesce(filed.client_event_id, '')) like 'maat:%'
        then 'legacy_maat_event'
      when public.user_event_recently_deleted(filed.user_id, filed.client_event_id)
        then 'event_deletion_trash'
      when filed.filed_flow_id is not null and filed.flow_active is null
        then 'orphaned_flow_reference'
      when filed.filed_flow_id is not null
        and public.flow_is_deleted_state(
          filed.flow_active,
          filed.flow_is_hidden,
          filed.flow_notes
        )
        then 'deleted_flow'
      else null
    end as reason_deleted,
    case
      when coalesce(filed.all_day, false)
        and filed.ends_at is not null
        and filed.ends_at > filed.starts_at
        then 'all_day_valid_ends_at'
      when coalesce(filed.all_day, false)
        then 'all_day_local_day_end'
      when filed.ends_at is not null
        and filed.ends_at > filed.starts_at
        then 'timed_valid_ends_at'
      else 'starts_at'
    end as reason_active_until
  from filed
),
classified as (
  select
    reasoned.*,
    case
      when lower(coalesce(reasoned.client_event_id, '')) like 'reminder:%'
        or lower(coalesce(reasoned.client_event_id, '')) like 'nutrition:%'
        or coalesce(reasoned.flow_is_reminder, false) then 'reminder'
      when reasoned.filed_flow_id is not null
        or lower(coalesce(reasoned.client_event_id, '')) like 'maat:%' then 'flow'
      else 'note'
    end as item_kind,
    (reasoned.reason_deleted is not null) as is_deleted,
    coalesce(reasoned.flow_is_saved, false) as is_saved,
    (reasoned.calendar_is_personal = false) as is_shared_calendar_source,
    reasoned.has_event_share as is_event_share_source,
    reasoned.has_flow_share as is_flow_share_source,
    reasoned.has_flow_post as is_flow_post_source,
    coalesce(reasoned.flow_is_saved, false) as is_flow_saved_source,
    reasoned.has_active_reminder as is_active_reminder_source,
    reasoned.has_scheduled_notification as is_scheduled_notification_source
  from reasoned
),
projected as (
  select
    classified.*,
    case
      when classified.is_deleted then 'deleted'
      else classified.date_lifecycle
    end as lifecycle,
    (
      classified.is_deleted = false
      and classified.date_lifecycle = 'active'
    ) as live_on_calendar,
    (
      classified.is_shared_calendar_source
      or classified.is_event_share_source
      or classified.is_flow_share_source
    ) as is_shared,
    classified.is_flow_post_source as is_posted
  from classified
)
select
  projected.*,
  jsonb_build_object(
    'item_kind', jsonb_build_object(
      'value', projected.item_kind,
      'reason', projected.reason_item_kind
    ),
    'lifecycle', jsonb_build_object(
      'value', projected.lifecycle,
      'date_lifecycle', projected.date_lifecycle,
      'deleted_reason', projected.reason_deleted,
      'active_until', projected.active_until,
      'active_until_reason', projected.reason_active_until,
      'timezone', projected.user_timezone
    ),
    'calendar', jsonb_build_object(
      'calendar_id', projected.calendar_id,
      'calendar_name', projected.calendar_name,
      'calendar_is_personal', projected.calendar_is_personal,
      'live_on_calendar', projected.live_on_calendar
    ),
    'share_sources', jsonb_build_object(
      'shared_calendar', projected.is_shared_calendar_source,
      'event_share', projected.is_event_share_source,
      'flow_share', projected.is_flow_share_source
    ),
    'post_sources', jsonb_build_object(
      'flow_post', projected.is_flow_post_source
    ),
    'save_sources', jsonb_build_object(
      'flow_saved', projected.is_flow_saved_source
    ),
    'reminder_sources', jsonb_build_object(
      'active_reminder', projected.is_active_reminder_source,
      'scheduled_notification', projected.is_scheduled_notification_source
    )
  ) as filing_reasons
from projected
where projected.lifecycle <> 'deleted';

create view public.user_event_filing_items
with (security_invoker = true) as
select *
from public.user_event_filing_items_client;

revoke all on private.user_event_filing_items_internal from public;
revoke all on private.user_event_filing_items_internal from anon;
revoke all on private.user_event_filing_items_internal from authenticated;
grant select on private.user_event_filing_items_internal to service_role;

grant select on public.user_event_filing_items_client to authenticated;
grant select on public.user_event_filing_items to authenticated;

comment on view public.user_event_filing_items_client is
'Client-safe canonical event filing view. Deleted/trash lifecycle rows are excluded at the API surface.';

comment on view private.user_event_filing_items_internal is
'Internal audit filing view with deleted lifecycle rows and justification fields. Not granted to client API roles.';

notify pgrst, 'reload schema';
