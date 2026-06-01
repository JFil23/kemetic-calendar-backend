-- Phase 5 Stage A: user preferences (preferred/avoid hours) + compute + fetch

create table if not exists public.ukg_user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  computed_at timestamptz not null default now(),
  window_days integer not null default 90,
  timezone text not null default 'UTC',
  prefs_version text not null default 'prefs_v1',
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists ukg_user_preferences_computed_at_idx
  on public.ukg_user_preferences (computed_at desc);

-- Helpful for preference compute queries
create index if not exists user_events_user_starts_at_idx
  on public.user_events (user_id, starts_at desc);

-- Completion window scan for compute_user_preferences_impl
create index if not exists user_event_completions_user_completed_at_idx
  on public.user_event_completions (user_id, completed_at desc);

alter table public.ukg_user_preferences enable row level security;

drop policy if exists ukg_user_preferences_select_own on public.ukg_user_preferences;
create policy ukg_user_preferences_select_own on public.ukg_user_preferences
  for select using (user_id = auth.uid());

drop policy if exists ukg_user_preferences_insert_own on public.ukg_user_preferences;
create policy ukg_user_preferences_insert_own on public.ukg_user_preferences
  for insert with check (user_id = auth.uid());

drop policy if exists ukg_user_preferences_update_own on public.ukg_user_preferences;
create policy ukg_user_preferences_update_own on public.ukg_user_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Helper: user timezone, defaults to UTC
create or replace function public._get_user_timezone(p_uid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select p.timezone
    from public.profiles p
    where p.id = p_uid
  ), 'UTC');
$$;

-- Helper: personalization gate, defaults to true
create or replace function public._is_personalization_enabled(p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select p.personalization_enabled
    from public.profiles p
    where p.id = p_uid
  ), true);
$$;

-- Core compute (service/impl)
create or replace function public.compute_user_preferences_impl(
  p_uid uuid,
  p_window_days integer default 90
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_tz text;
  v_window_start timestamptz;
  v_now timestamptz;
  v_sample_min integer := 3;
  v_top_n integer := 6;

  v_sched jsonb := '{}'::jsonb;
  v_comp jsonb := '{}'::jsonb;
  v_sched_total integer := 0;
  v_comp_total integer := 0;

  v_preferred integer[] := '{}';
  v_avoid integer[] := '{}';
  v_prefs jsonb;
begin
  if p_uid is null then
    raise exception 'user_id required';
  end if;

  if not _is_personalization_enabled(p_uid) then
    return;
  end if;

  v_days := greatest(7, least(coalesce(p_window_days, 90), 365));
  v_tz := _get_user_timezone(p_uid);
  v_now := now();
  v_window_start := v_now - make_interval(days => v_days);

  with
  hours as (
    select generate_series(0, 23) as hour_bucket
  ),
  scheduled as (
    select
      greatest(
        0,
        least(
          23,
          case
            when e.all_day then 9
            when cast(date_part('hour', e.starts_at at time zone v_tz) as integer) = 0
              and cast(date_part('minute', e.starts_at at time zone v_tz) as integer) = 0 then 9
            else cast(date_part('hour', e.starts_at at time zone v_tz) as integer)
          end
        )
      ) as hour_bucket,
      count(*) as scheduled_count
    from public.user_events e
    where e.user_id = p_uid
      and e.flow_local_id is not null
      and e.starts_at >= v_window_start
      and e.starts_at < v_now
    group by 1
  ),
  completed as (
    select
      greatest(
        0,
        least(
          23,
          case
            when e.all_day then 9
            when cast(date_part('hour', e.starts_at at time zone v_tz) as integer) = 0
              and cast(date_part('minute', e.starts_at at time zone v_tz) as integer) = 0 then 9
            else cast(date_part('hour', e.starts_at at time zone v_tz) as integer)
          end
        )
      ) as hour_bucket,
      count(*) as completed_count
    from public.user_event_completions c
    join public.user_events e
      on e.user_id = c.user_id
     and e.client_event_id = c.client_event_id
     and e.client_event_id is not null
     and c.client_event_id is not null
     and e.flow_local_id is not null
    where c.user_id = p_uid
      and c.completed_at >= v_window_start
      and c.completed_at < v_now
    group by 1
  ),
  stats as (
    select
      h.hour_bucket,
      coalesce(s.scheduled_count, 0) as scheduled_count,
      coalesce(c.completed_count, 0) as completed_count
    from hours h
    left join scheduled s on s.hour_bucket = h.hour_bucket
    left join completed  c on c.hour_bucket = h.hour_bucket
  ),
  enriched as (
    select
      hour_bucket,
      scheduled_count,
      completed_count,
      case
        when scheduled_count > 0
          then round((completed_count::numeric / scheduled_count::numeric), 4)
        else null::numeric
      end as completion_rate,
      (sum(completed_count) over ()) as completed_total_all
    from stats
  )
  select
    coalesce(jsonb_object_agg(hour_bucket::text, scheduled_count order by hour_bucket), '{}'::jsonb),
    coalesce(jsonb_object_agg(hour_bucket::text, completed_count order by hour_bucket), '{}'::jsonb),
    coalesce(sum(scheduled_count), 0),
    coalesce(sum(completed_count), 0),
    coalesce((
      select array(
        select hour_bucket
        from enriched
        where scheduled_count >= v_sample_min
        order by
          case
            when completed_total_all > 0 then completion_rate
            else scheduled_count::numeric
          end desc nulls last,
          hour_bucket asc
        limit v_top_n
      )
    ), '{}'::integer[]),
    coalesce((
      select array(
        select hour_bucket
        from enriched
        where scheduled_count >= v_sample_min
        order by
          case
            when completed_total_all > 0 then completion_rate
            else scheduled_count::numeric
          end asc nulls last,
          hour_bucket asc
        limit v_top_n
      )
    ), '{}'::integer[])
  into v_sched, v_comp, v_sched_total, v_comp_total, v_preferred, v_avoid
  from enriched;

  v_prefs := jsonb_build_object(
    'version', 'prefs_v1',
    'timezone_used', v_tz,
    'window_days', v_days,
    'preferred_hours', v_preferred,
    'avoid_hours', v_avoid,
    'schedule_by_hour', v_sched,
    'completion_by_hour', v_comp,
    'counts', jsonb_build_object(
      'scheduled_total', v_sched_total,
      'completed_total', v_comp_total
    )
  );

  insert into public.ukg_user_preferences
    (user_id, computed_at, window_days, timezone, prefs_version, prefs, updated_at)
  values
    (p_uid, v_now, v_days, v_tz, 'prefs_v1', v_prefs, v_now)
  on conflict (user_id) do update set
    computed_at = excluded.computed_at,
    window_days = excluded.window_days,
    timezone = excluded.timezone,
    prefs_version = excluded.prefs_version,
    prefs = excluded.prefs,
    updated_at = excluded.updated_at;
end;
$$;

-- Authenticated entrypoint (current user)
create or replace function public.compute_user_preferences(p_window_days integer default 90)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  perform public.compute_user_preferences_impl(v_uid, p_window_days);
end;
$$;

-- Service-role entrypoint (explicit user)
create or replace function public.compute_user_preferences_for(
  p_user_id uuid,
  p_window_days integer default 90
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_setting('request.jwt.claims.role', true);
begin
  if v_role is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  perform public.compute_user_preferences_impl(p_user_id, p_window_days);
end;
$$;

-- Read RPC for clients
create or replace function public.get_my_preferences()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_row jsonb;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  v_enabled := _is_personalization_enabled(v_uid);
  if not v_enabled then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', p.user_id,
    'computed_at', p.computed_at,
    'window_days', p.window_days,
    'timezone', p.timezone,
    'prefs_version', p.prefs_version,
    'prefs', p.prefs
  )
  into v_row
  from public.ukg_user_preferences p
  where p.user_id = v_uid;

  if not found then
    return null;
  end if;

  return v_row;
end;
$$;

revoke all on function public.compute_user_preferences(integer) from public;
revoke all on function public.compute_user_preferences_for(uuid, integer) from public;
revoke all on function public.get_my_preferences() from public;
revoke all on function public._get_user_timezone(uuid) from public;
revoke all on function public._is_personalization_enabled(uuid) from public;

grant execute on function public.compute_user_preferences(integer) to authenticated;
grant execute on function public.compute_user_preferences_for(uuid, integer) to service_role;
grant execute on function public.get_my_preferences() to authenticated;
grant execute on function public.get_my_preferences() to service_role;
