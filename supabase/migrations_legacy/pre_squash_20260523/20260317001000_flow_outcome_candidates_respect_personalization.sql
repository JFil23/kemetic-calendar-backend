-- Phase 4: exclude users with personalization_enabled = false
create or replace function public.flow_outcome_candidates(p_limit integer default 500)
returns table(flow_id bigint)
language sql
security definer
set search_path = public
as $$
  select f.id as flow_id
  from public.flows f
  join public.profiles p on p.id = f.user_id and coalesce(p.personalization_enabled, true) = true
  left join public.flow_outcomes o
    on o.user_id = f.user_id
    and o.flow_id = f.id
    and o.window_start = f.start_date::date
  where f.start_date is not null
    and f.end_date is not null
    and (f.end_date::date) < current_date
    and coalesce(f.is_hidden, false) = false
    and coalesce(f.is_reminder, false) = false
    and o.id is null
  order by f.end_date
  limit greatest(p_limit, 0);
$$;

comment on function public.flow_outcome_candidates(integer) is
'Returns ended, non-hidden, non-reminder flows with no outcome row for the start_date window, limited to users with personalization_enabled = true; used by cron to call compute_flow_outcome';

revoke all on function public.flow_outcome_candidates(integer) from public;
grant execute on function public.flow_outcome_candidates(integer) to service_role;
