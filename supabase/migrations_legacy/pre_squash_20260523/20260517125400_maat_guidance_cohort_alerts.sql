-- Expand Ma'at outcome cohorts beyond maturity level and expose ops alerts.

create or replace view public.maat_guidance_drift_outcome_flags_cohort
with (security_invoker = true)
as
with outcome_context as (
  select
    o.*,
    coalesce(e.maturity_level, 'unknown') as maturity_level,
    nullif(e.decision -> 'goal_profile' ->> 'key', '') as goal_profile_key,
    coalesce(nullif(split_part(p.timezone, '/', 1), ''), 'unknown') as timezone_region
  from public.maat_guidance_drift_outcomes o
  left join public.profiles p
    on p.id = o.user_id
  left join lateral (
    select maturity_level, decision
    from public.maat_guidance_evaluations e
    where e.user_id = o.user_id
      and e.decan_period_key = o.decan_period_key
      and e.created_at <= o.acted_at
    order by e.created_at desc
    limit 1
  ) e on true
),
cohort_rows as (
  select o.*, 'maturity_level'::text as cohort_type, o.maturity_level as cohort_key
  from outcome_context o
  union all
  select o.*, 'goal_profile'::text as cohort_type, o.goal_profile_key as cohort_key
  from outcome_context o
  where o.goal_profile_key is not null
  union all
  select o.*, 'timezone_region'::text as cohort_type, o.timezone_region as cohort_key
  from outcome_context o
),
measured as (
  select
    cohort_type,
    cohort_key,
    (date_trunc('week', acted_at))::date as acted_week,
    cta_type,
    cta_ref,
    count(*) filter (where post_window_complete) as completed_window_count,
    round(avg(delta_done_rate) filter (
      where post_window_complete and delta_done_rate is not null
    ), 4) as avg_delta_done_rate,
    round(avg(delta_skipped_rate) filter (
      where post_window_complete and delta_skipped_rate is not null
    ), 4) as avg_delta_skipped_rate
  from cohort_rows
  group by cohort_type, cohort_key, (date_trunc('week', acted_at))::date, cta_type, cta_ref
  having count(*) filter (where post_window_complete) > 0
),
aggregated as (
  select
    cohort_type,
    cohort_key,
    cta_type,
    cta_ref,
    count(*) filter (
      where avg_delta_done_rate is not null
    ) as measured_week_count,
    coalesce(sum(completed_window_count) filter (
      where avg_delta_done_rate is not null
    ), 0) as completed_window_count,
    coalesce(count(*) filter (
      where avg_delta_done_rate >= 0.05
    ), 0) as positive_week_count,
    coalesce(count(*) filter (
      where avg_delta_done_rate <= -0.05
    ), 0) as negative_week_count,
    round(
      coalesce(sum(avg_delta_done_rate * completed_window_count) filter (
        where avg_delta_done_rate is not null
      ), 0) /
      nullif(coalesce(sum(completed_window_count) filter (
        where avg_delta_done_rate is not null
      ), 0), 0),
      4
    ) as weighted_delta_done_rate,
    round(
      coalesce(sum(avg_delta_skipped_rate * completed_window_count) filter (
        where avg_delta_skipped_rate is not null
      ), 0) /
      nullif(coalesce(sum(completed_window_count) filter (
        where avg_delta_skipped_rate is not null
      ), 0), 0),
      4
    ) as weighted_delta_skipped_rate
  from measured
  group by cohort_type, cohort_key, cta_type, cta_ref
)
select
  cohort_type,
  cohort_key,
  cta_type,
  cta_ref,
  measured_week_count,
  completed_window_count,
  positive_week_count,
  negative_week_count,
  weighted_delta_done_rate,
  weighted_delta_skipped_rate,
  case
    when completed_window_count >= 5
      and measured_week_count >= 2
      and weighted_delta_done_rate >= 0.05
      and positive_week_count > negative_week_count
      then 'winning'
    when completed_window_count >= 5
      and measured_week_count >= 2
      and weighted_delta_done_rate <= -0.05
      and negative_week_count >= positive_week_count
      then 'negative'
    else 'neutral'
  end as outcome_flag
from aggregated;

create or replace view public.maat_guidance_ops_alerts
with (security_invoker = true)
as
with recent_summary as (
  select
    cta_type,
    cta_ref,
    coalesce(sum(completed_window_count), 0) as recent_completed_window_count,
    round(
      coalesce(sum(avg_delta_done_rate * completed_window_count) filter (
        where avg_delta_done_rate is not null
      ), 0) /
      nullif(coalesce(sum(completed_window_count) filter (
        where avg_delta_done_rate is not null
      ), 0), 0),
      4
    ) as recent_weighted_delta_done_rate
  from public.maat_guidance_drift_outcome_summary
  where acted_week >= current_date - 28
  group by cta_type, cta_ref
),
global_regressions as (
  select
    'winning_cta_recent_regression'::text as alert_key,
    'warning'::text as severity,
    f.cta_type,
    f.cta_ref,
    null::text as cohort_type,
    null::text as cohort_key,
    jsonb_build_object(
      'outcome_flag', f.outcome_flag,
      'recent_completed_window_count', r.recent_completed_window_count,
      'recent_weighted_delta_done_rate', r.recent_weighted_delta_done_rate,
      'global_weighted_delta_done_rate', f.weighted_delta_done_rate
    ) as details
  from public.maat_guidance_drift_outcome_flags f
  join recent_summary r
    on r.cta_type = f.cta_type
   and r.cta_ref is not distinct from f.cta_ref
  where f.outcome_flag = 'winning'
    and r.recent_completed_window_count >= 5
    and r.recent_weighted_delta_done_rate < 0
),
negative_dawn_house as (
  select
    'dawn_house_negative_signal'::text as alert_key,
    'warning'::text as severity,
    f.cta_type,
    f.cta_ref,
    null::text as cohort_type,
    null::text as cohort_key,
    jsonb_build_object(
      'outcome_flag', f.outcome_flag,
      'completed_window_count', f.completed_window_count,
      'weighted_delta_done_rate', f.weighted_delta_done_rate
    ) as details
  from public.maat_guidance_drift_outcome_flags f
  where f.cta_type = 'flow_template'
    and f.cta_ref = 'dawn-house-rite'
    and f.outcome_flag = 'negative'
),
cohort_negative as (
  select
    'cohort_negative_signal'::text as alert_key,
    'observe'::text as severity,
    f.cta_type,
    f.cta_ref,
    f.cohort_type,
    f.cohort_key,
    jsonb_build_object(
      'outcome_flag', f.outcome_flag,
      'completed_window_count', f.completed_window_count,
      'weighted_delta_done_rate', f.weighted_delta_done_rate
    ) as details
  from public.maat_guidance_drift_outcome_flags_cohort f
  where f.outcome_flag = 'negative'
)
select * from global_regressions
union all
select * from negative_dawn_house
union all
select * from cohort_negative;

grant select on public.maat_guidance_drift_outcome_flags_cohort
  to anon, authenticated, service_role;
grant select on public.maat_guidance_ops_alerts
  to anon, authenticated, service_role;
