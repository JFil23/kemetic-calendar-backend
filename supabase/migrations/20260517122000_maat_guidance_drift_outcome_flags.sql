-- Conservative CTA outcome flags for Ma'at drift nudges.
-- This aggregates the weekly summary and labels CTA classes only after enough
-- completed post windows exist to make the signal worth considering.

create or replace view public.maat_guidance_drift_outcome_flags
with (security_invoker = true)
as
with measured as (
  select
    cta_type,
    cta_ref,
    completed_window_count,
    avg_delta_done_rate,
    avg_delta_skipped_rate
  from public.maat_guidance_drift_outcome_summary
  where completed_window_count > 0
),
aggregated as (
  select
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
  group by cta_type, cta_ref
)
select
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

grant select on public.maat_guidance_drift_outcome_flags
  to anon, authenticated, service_role;
