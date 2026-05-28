create or replace function public.user_event_active_until(
  p_user_id uuid,
  p_all_day boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  with tz as (
    select coalesce(nullif(public._get_user_timezone(p_user_id), ''), 'UTC') as name
  )
  select case
    when p_starts_at is null then null
    when coalesce(p_all_day, false) then
      case
        when p_ends_at is not null and p_ends_at > p_starts_at then p_ends_at
        else (
          (p_starts_at at time zone (select name from tz))::date
          + interval '1 day'
        ) at time zone (select name from tz)
      end
    else case
      when p_ends_at is not null and p_ends_at > p_starts_at then p_ends_at
      else p_starts_at
    end
  end
$$;

comment on function public.user_event_active_until(uuid, boolean, timestamptz, timestamptz) is
'Returns the authoritative instant through which a user_events row remains live on the calendar. All-day rows remain live through the end of their local calendar day.';

create or replace function public.user_event_date_lifecycle(
  p_user_id uuid,
  p_all_day boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_now timestamptz default now()
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when public.user_event_active_until(
      p_user_id,
      p_all_day,
      p_starts_at,
      p_ends_at
    ) >= coalesce(p_now, now())
      then 'active'
    else 'inactive'
  end
$$;

comment on function public.user_event_date_lifecycle(uuid, boolean, timestamptz, timestamptz, timestamptz) is
'Date-only lifecycle predicate for event filing. Active means the event has not ended yet; inactive means it has already passed.';

drop view if exists public.user_event_filing_items;

create view public.user_event_filing_items
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
    case
      when lower(coalesce(ue.client_event_id, '')) like 'reminder:%'
        or lower(coalesce(ue.client_event_id, '')) like 'nutrition:%'
        or coalesce(f.is_reminder, false) then 'reminder'
      when ref.flow_id is not null
        or lower(coalesce(ue.client_event_id, '')) like 'maat:%' then 'flow'
      else 'note'
    end as item_kind,
    (
      lower(coalesce(ue.category, '')) = 'tombstone'
      or lower(coalesce(ue.client_event_id, '')) like 'reminder:tombstone:%'
      or lower(coalesce(ue.client_event_id, '')) like 'maat:%'
      or public.user_event_recently_deleted(ue.user_id, ue.client_event_id)
      or (
        ref.flow_id is not null
        and (
          f.id is null
          or public.flow_is_deleted_state(
            f.active,
            f.is_hidden,
            f.notes
          )
        )
      )
    ) as is_deleted,
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
)
select
  filed.*,
  case
    when filed.is_deleted then 'deleted'
    else filed.date_lifecycle
  end as lifecycle,
  (
    filed.is_deleted = false
    and filed.date_lifecycle = 'active'
  ) as live_on_calendar,
  coalesce(filed.flow_is_saved, false) as is_saved,
  (
    filed.calendar_is_personal = false
    or filed.has_event_share
    or filed.has_flow_share
  ) as is_shared,
  filed.has_flow_post as is_posted
from filed;

grant select on public.user_event_filing_items to authenticated;

notify pgrst, 'reload schema';
