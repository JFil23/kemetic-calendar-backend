-- Ops-facing dashboard for the Ma'at drift CTA outcome loop.
-- Shows the current routing flag, the measured week range, and compact weekly
-- history so operators can see when a CTA class is becoming preferred or weak.

create or replace view public.maat_guidance_drift_outcome_dashboard
with (security_invoker = true)
as
with weekly as (
  select
    acted_week,
    cta_type,
    cta_ref,
    acted_count,
    completed_window_count,
    avg_delta_done_rate,
    avg_delta_skipped_rate,
    avg_pre_done_rate,
    avg_post_done_rate
  from public.maat_guidance_drift_outcome_summary
  where completed_window_count > 0
),
weekly_rollup as (
  select
    cta_type,
    cta_ref,
    min(acted_week) as first_measured_week,
    max(acted_week) as latest_measured_week,
    jsonb_agg(
      jsonb_build_object(
        'week', acted_week,
        'acted_count', acted_count,
        'completed_window_count', completed_window_count,
        'avg_delta_done_rate', avg_delta_done_rate,
        'avg_delta_skipped_rate', avg_delta_skipped_rate,
        'avg_pre_done_rate', avg_pre_done_rate,
        'avg_post_done_rate', avg_post_done_rate
      )
      order by acted_week desc
    ) as weekly_history
  from weekly
  group by cta_type, cta_ref
)
select
  f.cta_type,
  f.cta_ref,
  f.outcome_flag,
  case
    when f.outcome_flag = 'winning' then 'prefer_when_candidate'
    when f.outcome_flag = 'negative' then 'avoid_when_alternative_exists'
    else 'observe_only'
  end as routing_effect,
  f.measured_week_count,
  f.completed_window_count,
  f.positive_week_count,
  f.negative_week_count,
  f.weighted_delta_done_rate,
  f.weighted_delta_skipped_rate,
  w.first_measured_week,
  w.latest_measured_week,
  coalesce(w.weekly_history, '[]'::jsonb) as weekly_history,
  'requires >=5 completed windows, >=2 measured weeks, and abs(weighted_delta_done_rate) >= 0.05'::text
    as flag_rule
from public.maat_guidance_drift_outcome_flags f
left join weekly_rollup w
  on w.cta_type = f.cta_type
 and w.cta_ref is not distinct from f.cta_ref;

grant select on public.maat_guidance_drift_outcome_dashboard
  to anon, authenticated, service_role;
