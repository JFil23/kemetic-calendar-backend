create or replace function public.user_event_suppressing_tombstone_refs(
  p_user_ids uuid[]
)
returns table(user_id uuid, client_event_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct
    edt.user_id,
    edt.client_event_id
  from public.event_deletion_trash edt
  where edt.user_id = any(coalesce(p_user_ids, array[]::uuid[]))
    and edt.client_event_id is not null
    and edt.purged_at is null
    and edt.purge_after > timezone('utc', now())
    and edt.suppresses_client = true
$$;
revoke all on function public.user_event_suppressing_tombstone_refs(uuid[])
from public;
grant execute on function public.user_event_suppressing_tombstone_refs(uuid[])
to authenticated;
grant execute on function public.user_event_suppressing_tombstone_refs(uuid[])
to service_role;
comment on function public.user_event_suppressing_tombstone_refs(uuid[]) is
'Returns suppressing tombstone client-event refs for a bounded set of event owners. Used by summary views to avoid per-event security-definer tombstone checks.';
create or replace view public.shared_calendar_filing_items_client
with (security_invoker = true)
as
with accepted_calendars as materialized (
  select
    scm.calendar_id,
    scm.user_id,
    scm.role,
    scm.status
  from public.shared_calendar_members scm
  where scm.user_id = auth.uid()
    and scm.status = 'accepted'
),
base_events as materialized (
  select
    ac.calendar_id,
    ue.user_id,
    ue.client_event_id,
    ue.category,
    ue.flow_local_id,
    ue.all_day,
    ue.starts_at,
    ue.ends_at
  from accepted_calendars ac
  join public.user_events ue
    on ue.calendar_id = ac.calendar_id
),
event_users as materialized (
  select distinct be.user_id
  from base_events be
  where be.user_id is not null
),
suppressing_tombstones as materialized (
  select refs.user_id, refs.client_event_id
  from public.user_event_suppressing_tombstone_refs(
    array(select event_users.user_id from event_users)
  ) refs
),
event_rows as (
  select
    be.calendar_id,
    be.user_id,
    be.client_event_id,
    be.category,
    be.flow_local_id,
    case
      when be.starts_at is null then false
      when be.ends_at is not null and be.ends_at > be.starts_at then
        be.ends_at >= timezone('utc', now())
      when coalesce(be.all_day, false) then
        be.starts_at + interval '1 day' >= timezone('utc', now())
      else be.starts_at >= timezone('utc', now())
    end as is_live,
    (
      lower(coalesce(be.category, '')) = 'tombstone'
      or lower(coalesce(be.client_event_id, '')) like 'reminder:tombstone:%'
      or lower(coalesce(be.client_event_id, '')) like 'maat:%'
      or tombstone_match.found is not null
    ) as is_deleted
  from base_events be
  left join lateral (
    select public.user_event_reminder_uuid(be.client_event_id) as reminder_uuid
    where lower(coalesce(be.client_event_id, '')) like 'reminder:%'
  ) reminder on true
  left join lateral (
    select true as found
    from suppressing_tombstones st
    where st.user_id = be.user_id
      and (
        st.client_event_id = be.client_event_id
        or (
          reminder.reminder_uuid is not null
          and st.client_event_id in (
            'reminder:' || reminder.reminder_uuid::text,
            'reminder:rule:' || reminder.reminder_uuid::text
          )
        )
      )
    limit 1
  ) tombstone_match on true
),
calendar_event_counts as materialized (
  select
    er.calendar_id,
    count(*) filter (where not er.is_deleted) as total_event_count,
    count(*) filter (
      where not er.is_deleted
        and er.is_live
    ) as live_event_count,
    count(*) filter (
      where not er.is_deleted
        and not er.is_live
    ) as inactive_event_count,
    count(distinct er.flow_local_id) filter (
      where not er.is_deleted
        and er.flow_local_id is not null
        and er.is_live
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
'Client-safe accepted-calendar filing summary. Event counts use indexed calendar rows with set-based tombstone suppression so startup summaries avoid per-event security-definer checks.';
notify pgrst, 'reload schema';
