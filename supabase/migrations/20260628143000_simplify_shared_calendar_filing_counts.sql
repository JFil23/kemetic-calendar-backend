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
event_rows as (
  select
    ac.calendar_id,
    ue.user_id,
    ue.client_event_id,
    ue.category,
    ue.flow_local_id,
    public.user_event_date_lifecycle(
      ue.user_id,
      ue.all_day,
      ue.starts_at,
      ue.ends_at
    ) as date_lifecycle,
    (
      lower(coalesce(ue.category, '')) = 'tombstone'
      or lower(coalesce(ue.client_event_id, '')) like 'reminder:tombstone:%'
      or lower(coalesce(ue.client_event_id, '')) like 'maat:%'
      or public.user_event_has_suppressing_tombstone(
        ue.user_id,
        ue.client_event_id
      )
      or (
        ue.flow_local_id is not null
        and f.id is null
      )
      or (
        ue.flow_local_id is not null
        and public.flow_is_deleted_state(f.active, f.is_hidden, f.notes)
      )
    ) as is_deleted
  from accepted_calendars ac
  join public.user_events ue
    on ue.calendar_id = ac.calendar_id
  left join public.flows f
    on f.id = ue.flow_local_id
   and f.user_id = ue.user_id
),
calendar_event_counts as (
  select
    er.calendar_id,
    count(*) filter (where not er.is_deleted) as total_event_count,
    count(*) filter (
      where not er.is_deleted
        and er.date_lifecycle = 'active'
    ) as live_event_count,
    count(*) filter (
      where not er.is_deleted
        and er.date_lifecycle = 'inactive'
    ) as inactive_event_count,
    count(distinct er.flow_local_id) filter (
      where not er.is_deleted
        and er.flow_local_id is not null
        and er.date_lifecycle = 'active'
    ) as live_flow_count
  from event_rows er
  group by er.calendar_id
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
'Client-safe accepted-calendar filing summary. Event counts use accepted-calendar-scoped user_events rows directly so startup calendar summaries avoid the heavier event filing parser path.';
notify pgrst, 'reload schema';
