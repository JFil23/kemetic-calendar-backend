-- Prefs cron: users who need prefs computed (missing or stale)
create or replace function public.dm_user_pref_candidates(p_limit integer default 200)
returns table(user_id uuid)
language sql
security definer
set search_path = public
as $$
  with active as (
    select ue.user_id
    from public.user_events ue
    where ue.starts_at >= now() - interval '30 days'
    group by ue.user_id

    union

    select f.user_id
    from public.flows f
    where f.created_at >= now() - interval '30 days'
    group by f.user_id
  ),
  need_prefs as (
    select a.user_id
    from active a
    left join public.ukg_user_preferences p on p.user_id = a.user_id
    where p.user_id is null
       or p.computed_at < now() - interval '7 days'
  )
  select need_prefs.user_id
  from need_prefs
  limit greatest(coalesce(p_limit, 200), 0);
$$;

comment on function public.dm_user_pref_candidates(integer) is
'Returns user_ids with recent activity and missing or stale ukg_user_preferences; used by cron_compute_user_preferences.';

revoke all on function public.dm_user_pref_candidates(integer) from public;
grant execute on function public.dm_user_pref_candidates(integer) to service_role;
