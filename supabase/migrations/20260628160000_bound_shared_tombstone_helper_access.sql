create or replace function public.user_event_suppressing_tombstone_refs(
  p_event_user_ids uuid[],
  p_source_client_event_ids text[],
  p_candidate_client_event_ids text[]
)
returns table(user_id uuid, source_client_event_id text, client_event_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with requested_refs as (
    select distinct
      refs.user_id,
      refs.source_client_event_id,
      refs.candidate_client_event_id
    from unnest(
      coalesce(p_event_user_ids, array[]::uuid[]),
      coalesce(p_source_client_event_ids, array[]::text[]),
      coalesce(p_candidate_client_event_ids, array[]::text[])
    ) as refs(user_id, source_client_event_id, candidate_client_event_id)
    where refs.user_id is not null
      and refs.source_client_event_id is not null
      and refs.candidate_client_event_id is not null
  ),
  permitted_refs as (
    select distinct
      rr.user_id,
      rr.source_client_event_id,
      rr.candidate_client_event_id
    from requested_refs rr
    join public.shared_calendar_members scm
      on scm.user_id = auth.uid()
      and scm.status = 'accepted'
    join public.user_events ue
      on ue.calendar_id = scm.calendar_id
      and ue.user_id = rr.user_id
      and ue.client_event_id = rr.source_client_event_id
  )
  select distinct
    edt.user_id,
    pr.source_client_event_id,
    edt.client_event_id
  from permitted_refs pr
  join public.event_deletion_trash edt
    on edt.user_id = pr.user_id
    and edt.client_event_id = pr.candidate_client_event_id
  where edt.client_event_id is not null
    and edt.purged_at is null
    and edt.purge_after > timezone('utc', now())
    and edt.suppresses_client = true
$$;
revoke all on function public.user_event_suppressing_tombstone_refs(
  uuid[],
  text[],
  text[]
) from public;
grant execute on function public.user_event_suppressing_tombstone_refs(
  uuid[],
  text[],
  text[]
) to authenticated;
grant execute on function public.user_event_suppressing_tombstone_refs(
  uuid[],
  text[],
  text[]
) to service_role;
comment on function public.user_event_suppressing_tombstone_refs(
  uuid[],
  text[],
  text[]
) is
'Returns suppressing tombstone refs only for source events visible through the caller''s accepted shared calendars. Used by summary views to avoid per-event security-definer tombstone checks without exposing arbitrary deletion refs.';
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
event_ref_candidates as materialized (
  select
    be.user_id,
    be.client_event_id as source_client_event_id,
    be.client_event_id as candidate_client_event_id
  from base_events be
  where be.user_id is not null
    and be.client_event_id is not null
  union all
  select
    be.user_id,
    be.client_event_id as source_client_event_id,
    'reminder:' || public.user_event_reminder_uuid(be.client_event_id)::text
      as candidate_client_event_id
  from base_events be
  where be.user_id is not null
    and be.client_event_id is not null
    and lower(be.client_event_id) like 'reminder:%'
    and public.user_event_reminder_uuid(be.client_event_id) is not null
  union all
  select
    be.user_id,
    be.client_event_id as source_client_event_id,
    'reminder:rule:' || public.user_event_reminder_uuid(be.client_event_id)::text
      as candidate_client_event_id
  from base_events be
  where be.user_id is not null
    and be.client_event_id is not null
    and lower(be.client_event_id) like 'reminder:%'
    and public.user_event_reminder_uuid(be.client_event_id) is not null
),
candidate_arrays as materialized (
  select
    coalesce(
      array_agg(
        erc.user_id
        order by
          erc.user_id,
          erc.source_client_event_id,
          erc.candidate_client_event_id
      ),
      array[]::uuid[]
    ) as event_user_ids,
    coalesce(
      array_agg(
        erc.source_client_event_id
        order by
          erc.user_id,
          erc.source_client_event_id,
          erc.candidate_client_event_id
      ),
      array[]::text[]
    ) as source_client_event_ids,
    coalesce(
      array_agg(
        erc.candidate_client_event_id
        order by
          erc.user_id,
          erc.source_client_event_id,
          erc.candidate_client_event_id
      ),
      array[]::text[]
    ) as candidate_client_event_ids
  from event_ref_candidates erc
),
suppressing_tombstones as materialized (
  select
    refs.user_id,
    refs.source_client_event_id,
    refs.client_event_id
  from candidate_arrays ca
  cross join lateral public.user_event_suppressing_tombstone_refs(
    ca.event_user_ids,
    ca.source_client_event_ids,
    ca.candidate_client_event_ids
  ) refs
),
event_rows as (
  select
    be.calendar_id,
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
    select true as found
    from suppressing_tombstones st
    where st.user_id = be.user_id
      and st.source_client_event_id = be.client_event_id
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
drop function if exists public.user_event_suppressing_tombstone_refs(uuid[]);
revoke all on public.shared_calendar_filing_items_client from public;
revoke all on public.shared_calendar_filing_items_client from anon;
revoke all on public.shared_calendar_filing_items_client from authenticated;
grant select on public.shared_calendar_filing_items_client to authenticated;
grant select on public.shared_calendar_filing_items_client to service_role;
comment on view public.shared_calendar_filing_items_client is
'Client-safe accepted-calendar filing summary. Event counts use indexed calendar rows with set-based tombstone suppression bounded to caller-visible source events.';
notify pgrst, 'reload schema';
