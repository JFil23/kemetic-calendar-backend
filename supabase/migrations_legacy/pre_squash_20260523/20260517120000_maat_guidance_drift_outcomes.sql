-- Minimal outcome slice for Ma'at drift nudges.
-- Compares nutrition completion in the seven days before a drift CTA was
-- accepted with the seven days after. The action day is excluded to avoid
-- mixing pre/post events when journal_badges only has date precision.

create or replace view public.maat_guidance_drift_outcomes
with (security_invoker = true)
as
with acted as (
  select
    e.id as suggestion_event_id,
    e.user_id,
    e.created_at as acted_at,
    e.created_at::date as acted_date,
    d.id as delivery_id,
    d.decan_period_key,
    d.cta_type,
    d.cta_ref
  from public.user_choice_events e
  join public.maat_guidance_deliveries d
    on d.id::text = e.metadata->>'delivery_id'
  where e.event_type = 'suggestion_accepted'
    and d.kind = 'drift_nudge'
),
nutrition as (
  select
    jb.user_id,
    jb.occurred_on::date as occurred_on,
    case
      when 'state:done' = any(coalesce(jb.tags, '{}'::text[])) then 1
      else 0
    end as done_count,
    case
      when 'state:skipped' = any(coalesce(jb.tags, '{}'::text[])) then 1
      else 0
    end as skipped_count
  from public.journal_badges jb
  where 'kind:nutrition' = any(coalesce(jb.tags, '{}'::text[]))
),
aggregated as (
  select
    a.suggestion_event_id,
    a.user_id,
    a.acted_at,
    a.acted_date,
    a.delivery_id,
    a.decan_period_key,
    a.cta_type,
    a.cta_ref,
    count(n.occurred_on) filter (
      where n.occurred_on >= a.acted_date - 7
        and n.occurred_on < a.acted_date
    ) as pre_nutrition_count,
    coalesce(sum(n.done_count) filter (
      where n.occurred_on >= a.acted_date - 7
        and n.occurred_on < a.acted_date
    ), 0) as pre_done_count,
    coalesce(sum(n.skipped_count) filter (
      where n.occurred_on >= a.acted_date - 7
        and n.occurred_on < a.acted_date
    ), 0) as pre_skipped_count,
    count(n.occurred_on) filter (
      where n.occurred_on > a.acted_date
        and n.occurred_on <= a.acted_date + 7
    ) as post_nutrition_count,
    coalesce(sum(n.done_count) filter (
      where n.occurred_on > a.acted_date
        and n.occurred_on <= a.acted_date + 7
    ), 0) as post_done_count,
    coalesce(sum(n.skipped_count) filter (
      where n.occurred_on > a.acted_date
        and n.occurred_on <= a.acted_date + 7
    ), 0) as post_skipped_count
  from acted a
  left join nutrition n
    on n.user_id = a.user_id
   and n.occurred_on >= a.acted_date - 7
   and n.occurred_on <= a.acted_date + 7
  group by
    a.suggestion_event_id,
    a.user_id,
    a.acted_at,
    a.acted_date,
    a.delivery_id,
    a.decan_period_key,
    a.cta_type,
    a.cta_ref
)
select
  suggestion_event_id,
  user_id,
  acted_at,
  delivery_id,
  decan_period_key,
  cta_type,
  cta_ref,
  pre_nutrition_count,
  pre_done_count,
  pre_skipped_count,
  case
    when pre_nutrition_count = 0 then null
    else round(pre_done_count::numeric / pre_nutrition_count, 4)
  end as pre_done_rate,
  case
    when pre_nutrition_count = 0 then null
    else round(pre_skipped_count::numeric / pre_nutrition_count, 4)
  end as pre_skipped_rate,
  post_nutrition_count,
  post_done_count,
  post_skipped_count,
  case
    when post_nutrition_count = 0 then null
    else round(post_done_count::numeric / post_nutrition_count, 4)
  end as post_done_rate,
  case
    when post_nutrition_count = 0 then null
    else round(post_skipped_count::numeric / post_nutrition_count, 4)
  end as post_skipped_rate,
  case
    when pre_nutrition_count = 0 or post_nutrition_count = 0 then null
    else round(
      (post_done_count::numeric / post_nutrition_count) -
      (pre_done_count::numeric / pre_nutrition_count),
      4
    )
  end as delta_done_rate,
  case
    when pre_nutrition_count = 0 or post_nutrition_count = 0 then null
    else round(
      (post_skipped_count::numeric / post_nutrition_count) -
      (pre_skipped_count::numeric / pre_nutrition_count),
      4
    )
  end as delta_skipped_rate,
  current_date > acted_date + 7 as post_window_complete
from aggregated;

grant select on public.maat_guidance_drift_outcomes
  to anon, authenticated, service_role;
