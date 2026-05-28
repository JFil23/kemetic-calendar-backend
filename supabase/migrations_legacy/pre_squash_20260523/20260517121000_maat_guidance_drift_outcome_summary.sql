-- Weekly rollup for Ma'at drift-nudge outcome monitoring.

create or replace view public.maat_guidance_drift_outcome_summary
with (security_invoker = true)
as
select
  date_trunc('week', acted_at)::date as acted_week,
  cta_type,
  cta_ref,
  count(*) as acted_count,
  count(*) filter (where post_window_complete) as completed_window_count,
  round(avg(delta_done_rate) filter (
    where post_window_complete and delta_done_rate is not null
  ), 4) as avg_delta_done_rate,
  round(avg(delta_skipped_rate) filter (
    where post_window_complete and delta_skipped_rate is not null
  ), 4) as avg_delta_skipped_rate,
  round(avg(pre_done_rate) filter (
    where post_window_complete and pre_done_rate is not null
  ), 4) as avg_pre_done_rate,
  round(avg(post_done_rate) filter (
    where post_window_complete and post_done_rate is not null
  ), 4) as avg_post_done_rate
from public.maat_guidance_drift_outcomes
group by
  date_trunc('week', acted_at)::date,
  cta_type,
  cta_ref;

grant select on public.maat_guidance_drift_outcome_summary
  to anon, authenticated, service_role;
