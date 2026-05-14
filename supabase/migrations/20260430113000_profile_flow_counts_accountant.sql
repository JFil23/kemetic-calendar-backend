create or replace function public.flow_is_calendar_placed(
  p_active boolean,
  p_is_hidden boolean,
  p_is_reminder boolean,
  p_notes text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_active, false) = true
    and coalesce(p_is_hidden, false) = false
    and coalesce(p_is_reminder, false) = false
    and coalesce(p_notes, '') !~ '"kind"\\s*:\\s*"repeating_note"'
$$;

comment on function public.flow_is_calendar_placed(boolean, boolean, boolean, text) is
'Canonical flow placement predicate for user-facing active/inactive accounting: active row, not hidden, not reminder-backed, and not a repeating_note helper row.';

create or replace function public.flow_is_schedule_open(
  p_end_date date,
  p_timezone text,
  p_now timestamptz default timezone('utc', now())
)
returns boolean
language sql
stable
as $$
  select
    p_end_date is null
    or p_end_date >= ((p_now at time zone coalesce(nullif(btrim(p_timezone), ''), 'UTC'))::date)
$$;

comment on function public.flow_is_schedule_open(date, text, timestamptz) is
'Canonical schedule-open predicate for flow accounting. A flow remains open through its local end_date in the user timezone.';

create index if not exists user_event_completions_user_flow_client_event_idx
  on public.user_event_completions (user_id, flow_id, client_event_id);

create or replace function public.get_profile_flow_counts(p_user_id uuid)
returns table (
  active_flows_count bigint,
  total_flow_events_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  with tz as (
    select public._get_user_timezone(p_user_id) as timezone_name
  ),
  candidate_flows as (
    select f.id
    from public.flows f
    cross join tz
    where f.user_id = p_user_id
      and public.flow_is_calendar_placed(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      )
      and public.flow_is_schedule_open(
        f.end_date,
        tz.timezone_name
      )
  ),
  incomplete_events as (
    select ue.flow_local_id as flow_id
    from public.user_events ue
    join candidate_flows cf on cf.id = ue.flow_local_id
    left join public.user_event_completions uec
      on uec.user_id = ue.user_id
     and uec.flow_id = ue.flow_local_id
     and uec.client_event_id = ue.client_event_id
    where ue.user_id = p_user_id
      and coalesce(ue.category, '') <> 'tombstone'
      and (
        ue.client_event_id is null
        or btrim(ue.client_event_id) = ''
        or uec.id is null
      )
  )
  select
    count(distinct flow_id) as active_flows_count,
    count(*) as total_flow_events_count
  from incomplete_events;
$$;

comment on function public.get_profile_flow_counts(uuid) is
'Canonical accountant for profile flow counts. A flow is active only when it is calendar-placed, still open through its local end_date, and still has at least one incomplete non-tombstone user_event.';

revoke all on function public.get_profile_flow_counts(uuid) from public;
grant execute on function public.get_profile_flow_counts(uuid) to authenticated;

create or replace function public.get_my_flow_activity()
returns table (
  flow_id bigint,
  total_event_count bigint,
  remaining_event_count bigint,
  is_counted_active boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with me as (
    select auth.uid() as user_id
  ),
  tz as (
    select public._get_user_timezone((select user_id from me)) as timezone_name
  ),
  owned_flows as (
    select
      f.id,
      f.active,
      f.is_saved,
      f.is_hidden,
      f.is_reminder,
      f.end_date,
      f.notes
    from public.flows f
    join me on me.user_id = f.user_id
  ),
  flow_event_counts as (
    select
      ue.flow_local_id as flow_id,
      count(*) filter (
        where coalesce(ue.category, '') <> 'tombstone'
      ) as total_event_count,
      count(*) filter (
        where coalesce(ue.category, '') <> 'tombstone'
          and (
            ue.client_event_id is null
            or btrim(ue.client_event_id) = ''
            or uec.id is null
          )
      ) as remaining_event_count
    from public.user_events ue
    join me on me.user_id = ue.user_id
    left join public.user_event_completions uec
      on uec.user_id = ue.user_id
     and uec.flow_id = ue.flow_local_id
     and uec.client_event_id = ue.client_event_id
    where ue.flow_local_id is not null
    group by ue.flow_local_id
  )
  select
    f.id as flow_id,
    coalesce(c.total_event_count, 0) as total_event_count,
    coalesce(c.remaining_event_count, 0) as remaining_event_count,
    public.flow_is_calendar_placed(
      f.active,
      f.is_hidden,
      f.is_reminder,
      f.notes
    )
    and public.flow_is_schedule_open(
      f.end_date,
      (select timezone_name from tz)
    )
    and coalesce(c.remaining_event_count, 0) > 0 as is_counted_active
  from owned_flows f
  left join flow_event_counts c on c.flow_id = f.id;
$$;

comment on function public.get_my_flow_activity() is
'Authenticated flow accountant for the current user. Returns per-flow remaining event counts and the canonical active/inactive decision used by client flow lists, including local end_date closure.';

revoke all on function public.get_my_flow_activity() from public;
grant execute on function public.get_my_flow_activity() to authenticated;

create or replace view public.profile_stats as
select
  p.id,
  p.handle,
  p.display_name,
  p.avatar_url,
  p.bio,
  p.location,
  p.is_discoverable,
  p.allow_incoming_shares,
  p.created_at,
  p.updated_at,
  coalesce(flow_counts.active_flows_count, 0) as active_flows_count,
  coalesce(flow_counts.total_flow_events_count, 0) as total_flow_events_count,
  coalesce(followers.cnt, 0) as followers_count,
  coalesce(following.cnt, 0) as following_count,
  p.avatar_glyphs
from public.profiles p
left join lateral public.get_profile_flow_counts(p.id) flow_counts on true
left join lateral (
  select count(*)::bigint as cnt
  from public.follows fo
  where fo.followee_id = p.id
) followers on true
left join lateral (
  select count(*)::bigint as cnt
  from public.follows fo
  where fo.follower_id = p.id
) following on true;

notify pgrst, 'reload schema';
