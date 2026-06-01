-- Cohort-scoped CTA outcome flags for Ma'at drift nudges.
-- v1 cohorts are maturity levels from the nearest guidance evaluation at or
-- before the acted drift CTA. Routing uses user -> cohort -> global.

create or replace view public.maat_guidance_drift_outcome_flags_cohort
with (security_invoker = true)
as
with outcome_context as (
  select
    o.*,
    coalesce(e.maturity_level, 'unknown') as cohort_key
  from public.maat_guidance_drift_outcomes o
  left join lateral (
    select maturity_level
    from public.maat_guidance_evaluations e
    where e.user_id = o.user_id
      and e.decan_period_key = o.decan_period_key
      and e.created_at <= o.acted_at
    order by e.created_at desc
    limit 1
  ) e on true
),
measured as (
  select
    'maturity_level'::text as cohort_type,
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
  from outcome_context
  group by cohort_key, (date_trunc('week', acted_at))::date, cta_type, cta_ref
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

grant select on public.maat_guidance_drift_outcome_flags_cohort
  to anon, authenticated, service_role;
