-- Cut 11: teach the truth-loop reflection reader to understand the compact
-- reflection-generation Manifest v2 while preserving every v1 projection and
-- the Cut 9 canonical decan-opening predicate. The writer remains v1.

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
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then coalesce(
        r.metadata #>> '{manifest,truth,surface}',
        'decan_reflection'
      )
    else coalesce(
      r.metadata #>> '{output_control,plan,kind}',
      'decan_reflection'
    )
  end as surface,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then r.metadata #>> '{manifest,truth,speech_act}'
    else r.metadata #>> '{output_control,plan,speechAct}'
  end as speech_act,
  r.period_key as decan_period_key,
  'generated'::text as status,
  null::text as trigger_reason,
  null::text as cta_type,
  null::text as cta_ref,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then coalesce(
        r.metadata #>> '{manifest,truth,delivery_channel}',
        'archive_only'
      )
    else coalesce(
      r.metadata #>> '{output_control,grade,deliveryRecommendation}',
      'archive_only'
    )
  end as delivery_channel,
  null::text as teaser_text,
  r.generated_text as body_text,
  r.created_at as output_generated_at,
  null::timestamptz as shown_at,
  null::timestamptz as opened_at,
  null::timestamptz as dismissed_at,
  null::timestamptz as acted_at,
  null::timestamptz as expired_at,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      and r.metadata #> '{manifest,truth,grade}' is not null
      then jsonb_strip_nulls(jsonb_build_object(
        'pass',
          r.metadata #> '{manifest,truth,grade,pass}',
        'guidanceWorthinessScore',
          r.metadata #> '{manifest,truth,grade,guidance_worthiness_score}',
        'deliveryRecommendation',
          r.metadata #> '{manifest,truth,grade,delivery_recommendation}',
        'repairMode',
          r.metadata #> '{manifest,truth,grade,repair_mode}',
        'failureReasons',
          r.metadata #> '{manifest,truth,grade,failure_reasons}',
        'actionClarityScore',
          r.metadata #> '{manifest,truth,grade,action_clarity_score}'
      ))
    else r.metadata #> '{output_control,grade}'
  end as grade,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then coalesce(
        (r.metadata #>> '{manifest,truth,grade,pass}')::boolean,
        false
      )
    else coalesce(
      (r.metadata #>> '{output_control,grade,pass}')::boolean,
      false
    )
  end as grade_passed,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then nullif(
        r.metadata #>>
          '{manifest,truth,grade,guidance_worthiness_score}',
        ''
      )::numeric
    else nullif(
      r.metadata #>> '{output_control,grade,guidanceWorthinessScore}',
      ''
    )::numeric
  end as guidance_worthiness_score,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then r.metadata #>>
        '{manifest,truth,grade,delivery_recommendation}'
    else r.metadata #>> '{output_control,grade,deliveryRecommendation}'
  end as delivery_recommendation,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then coalesce(
        (r.metadata #>> '{manifest,truth,repair,attempted}')::boolean,
        false
      )
    else coalesce(
      (r.metadata #>> '{output_control,repair,attempted}')::boolean,
      false
    )
  end as repair_attempted,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then coalesce(
        (r.metadata #>> '{manifest,truth,repair,applied}')::boolean,
        false
      )
    else coalesce(
      (r.metadata #>> '{output_control,repair,applied}')::boolean,
      false
    )
  end as was_repaired,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then coalesce(
        r.metadata #>> '{manifest,truth,repair,mode}',
        r.metadata #>> '{manifest,truth,grade,repair_mode}'
      )
    else coalesce(
      r.metadata #>> '{output_control,repair,repair_mode}',
      r.metadata #>> '{output_control,grade,repairMode}'
    )
  end as repair_mode,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then coalesce(
        r.metadata #>> '{manifest,truth,repair,reason}',
        r.metadata #>> '{manifest,truth,grade,failure_reasons,0}'
      )
    else coalesce(
      r.metadata #>> '{output_control,repair,repair_reason}',
      r.metadata #>> '{output_control,grade,failureReasons,0}'
    )
  end as repair_reason,
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then r.metadata #> '{manifest,truth,repair,grade_delta}'
    else r.metadata #> '{output_control,repair,grade_delta}'
  end as repair_grade_delta,
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
  case
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      and r.metadata #> '{manifest,truth,repair}' is not null
      then jsonb_build_object(
        'repair',
        jsonb_strip_nulls(jsonb_build_object(
          'pre_repair_text',
            r.metadata #> '{manifest,truth,repair,pre_repair_text}',
          'post_repair_text',
            r.metadata #> '{manifest,truth,repair,post_repair_text}'
        ))
      )
    when r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
      then null::jsonb
    else r.metadata #> '{output_control}'
  end as output_control,
  null::text as cadence_type,
  null::text as cadence_mode
from public.reflection_generations r
where (
    r.metadata ? 'output_control'
    or r.metadata #>> '{manifest,version}' =
      'reflection_generation_manifest_v2'
  )
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
