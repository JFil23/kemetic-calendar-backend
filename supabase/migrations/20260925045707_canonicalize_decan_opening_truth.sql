-- Cut 9: make the current decan-opening delivery pointer the only truth-loop
-- authority for decan-opening reflection generations. All non-opening
-- reflection-generation behavior and the guidance branch remain unchanged.

create or replace view public.maat_output_truth_loop
with (security_invoker = true) as
select
  g.delivery_id::text as output_id,
  'maat_guidance_delivery'::text as source_type,
  g.user_id,
  g.surface,
  g.speech_act,
  g.decan_period_key,
  g.status,
  g.trigger_reason,
  g.cta_type,
  g.cta_ref,
  g.delivery_channel,
  g.teaser_text,
  g.body_text,
  g.output_generated_at,
  g.shown_at,
  g.opened_at,
  g.dismissed_at,
  g.acted_at,
  g.expired_at,
  g.grade,
  g.grade_passed,
  g.guidance_worthiness_score,
  g.delivery_recommendation,
  g.repair_attempted,
  g.was_repaired,
  g.repair_mode,
  g.repair_reason,
  g.repair_grade_delta,
  g.user_opened,
  g.user_acted,
  g.dismissed,
  g.was_interruptive,
  g.local_hour_shown,
  g.user_session_state,
  g.dismissed_within_seconds,
  g.time_to_open_minutes,
  g.time_to_act_minutes,
  g.followup_behavior_window,
  g.output_telemetry,
  null::jsonb as output_control,
  g.cadence_type,
  g.cadence_mode
from public.maat_guidance_output_truth_loop g
union all
select
  r.id::text as output_id,
  'reflection_generation'::text as source_type,
  r.user_id,
  coalesce(
    r.metadata #>> '{output_control,plan,kind}',
    'decan_reflection'
  ) as surface,
  r.metadata #>> '{output_control,plan,speechAct}' as speech_act,
  r.period_key as decan_period_key,
  'generated'::text as status,
  null::text as trigger_reason,
  null::text as cta_type,
  null::text as cta_ref,
  coalesce(
    r.metadata #>> '{output_control,grade,deliveryRecommendation}',
    'archive_only'
  ) as delivery_channel,
  null::text as teaser_text,
  r.generated_text as body_text,
  r.created_at as output_generated_at,
  null::timestamptz as shown_at,
  null::timestamptz as opened_at,
  null::timestamptz as dismissed_at,
  null::timestamptz as acted_at,
  null::timestamptz as expired_at,
  r.metadata #> '{output_control,grade}' as grade,
  coalesce(
    (r.metadata #>> '{output_control,grade,pass}')::boolean,
    false
  ) as grade_passed,
  nullif(
    r.metadata #>> '{output_control,grade,guidanceWorthinessScore}',
    ''
  )::numeric as guidance_worthiness_score,
  r.metadata #>> '{output_control,grade,deliveryRecommendation}'
    as delivery_recommendation,
  coalesce(
    (r.metadata #>> '{output_control,repair,attempted}')::boolean,
    false
  ) as repair_attempted,
  coalesce(
    (r.metadata #>> '{output_control,repair,applied}')::boolean,
    false
  ) as was_repaired,
  coalesce(
    r.metadata #>> '{output_control,repair,repair_mode}',
    r.metadata #>> '{output_control,grade,repairMode}'
  ) as repair_mode,
  coalesce(
    r.metadata #>> '{output_control,repair,repair_reason}',
    r.metadata #>> '{output_control,grade,failureReasons,0}'
  ) as repair_reason,
  r.metadata #> '{output_control,repair,grade_delta}' as repair_grade_delta,
  false as user_opened,
  false as user_acted,
  false as dismissed,
  false as was_interruptive,
  null::integer as local_hour_shown,
  null::text as user_session_state,
  null::numeric as dismissed_within_seconds,
  null::numeric as time_to_open_minutes,
  null::numeric as time_to_act_minutes,
  '{}'::jsonb as followup_behavior_window,
  null::jsonb as output_telemetry,
  r.metadata #> '{output_control}' as output_control,
  null::text as cadence_type,
  null::text as cadence_mode
from public.reflection_generations r
where r.metadata ? 'output_control'
  and (
    r.period_type is distinct from 'decan_opening'
    or exists (
      select 1
      from public.maat_guidance_deliveries d
      where d.kind = 'decan_opening'
        and d.generation_id = r.id
        and d.user_id = r.user_id
        and d.decan_period_key = r.period_key
    )
  );
