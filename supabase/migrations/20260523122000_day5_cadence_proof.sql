-- Day-5 Ma'at/Isfet cadence proof:
-- - one midpoint cadence delivery per user/decan
-- - cadence labels exposed in truth-loop and delivery review views

do $$
begin
  if exists (
    select 1
    from public.maat_guidance_deliveries
    where trigger_reason in ('decan_day_5_maat', 'decan_day_5_isfet')
    group by user_id, decan_period_key
    having count(*) > 1
  ) then
    raise exception
      'Duplicate day-5 cadence deliveries exist; resolve them before applying the cadence guard.';
  end if;
end
$$;

create unique index if not exists uq_maat_guidance_day5_cadence
  on public.maat_guidance_deliveries (user_id, decan_period_key)
  where trigger_reason in ('decan_day_5_maat', 'decan_day_5_isfet');

drop view if exists public.maat_output_truth_loop;

create or replace view public.maat_guidance_output_truth_loop
with (security_invoker = true) as
select
  d.id as delivery_id,
  d.user_id,
  d.kind as surface,
  coalesce(
    d.payload #>> '{output_control,plan,speechAct}',
    d.payload #>> '{output_telemetry,speech_act}'
  ) as speech_act,
  d.decan_period_key,
  d.status,
  d.trigger_reason,
  d.cta_type,
  d.cta_ref,
  d.teaser_text,
  d.body_text,
  coalesce(
    d.payload #>> '{delivery_channel}',
    d.payload #>> '{output_telemetry,delivery_channel}',
    d.payload #>> '{output_control,grade,deliveryRecommendation}'
  ) as delivery_channel,
  d.created_at as output_generated_at,
  d.shown_at,
  d.opened_at,
  d.dismissed_at,
  d.acted_at,
  d.expired_at,
  d.payload #> '{output_control,grade}' as grade,
  coalesce(
    (d.payload #>> '{output_control,grade,pass}')::boolean,
    false
  ) as grade_passed,
  nullif(
    d.payload #>> '{output_control,grade,guidanceWorthinessScore}',
    ''
  )::numeric as guidance_worthiness_score,
  d.payload #>> '{output_control,grade,deliveryRecommendation}'
    as delivery_recommendation,
  coalesce(
    (d.payload #>> '{output_control,repair,attempted}')::boolean,
    false
  ) as repair_attempted,
  coalesce(
    (d.payload #>> '{output_control,repair,applied}')::boolean,
    false
  ) as was_repaired,
  coalesce(
    d.payload #>> '{output_control,repair,repair_mode}',
    d.payload #>> '{output_control,grade,repairMode}'
  ) as repair_mode,
  coalesce(
    d.payload #>> '{output_control,repair,repair_reason}',
    d.payload #>> '{output_control,grade,failureReasons,0}'
  ) as repair_reason,
  d.payload #> '{output_control,repair,grade_delta}' as repair_grade_delta,
  coalesce(d.opened_at is not null or d.acted_at is not null, false)
    as user_opened,
  coalesce(d.acted_at is not null, false) as user_acted,
  coalesce(d.dismissed_at is not null, false) as dismissed,
  coalesce(
    (d.payload #>> '{output_telemetry,was_interruptive}')::boolean,
    coalesce(d.payload #>> '{delivery_channel}', '') <> 'archive_only'
  ) as was_interruptive,
  nullif(d.payload #>> '{output_telemetry,local_hour_shown}', '')::integer
    as local_hour_shown,
  d.payload #>> '{output_telemetry,user_session_state}'
    as user_session_state,
  nullif(
    d.payload #>> '{output_telemetry,dismissed_within_seconds}',
    ''
  )::numeric as dismissed_within_seconds,
  case
    when d.opened_at is null then null
    else round((
      extract(
        epoch from (
          d.opened_at - coalesce(d.shown_at, d.created_at)
        )
      ) / 60.0
    )::numeric,
      2
    )
  end as time_to_open_minutes,
  case
    when d.acted_at is null then null
    else round((
      extract(
        epoch from (
          d.acted_at - coalesce(d.shown_at, d.opened_at, d.created_at)
        )
      ) / 60.0
    )::numeric,
      2
    )
  end as time_to_act_minutes,
  jsonb_build_object(
    'planner_action_24h',
      exists (
        select 1
        from public.user_choice_events e
        where e.user_id = d.user_id
          and e.created_at > a.anchor_at
          and e.created_at <= a.anchor_at + interval '24 hours'
          and e.event_type in (
            'todo_completed',
            'checklist_completed',
            'checklist_partial',
            'flow_completed',
            'suggestion_accepted'
          )
      ),
    'journal_entry_24h',
      exists (
        select 1
        from public.journal_entries j
        where j.user_id = d.user_id
          and j.created_at > a.anchor_at
          and j.created_at <= a.anchor_at + interval '24 hours'
      ),
    'flow_resumed_48h',
      exists (
        select 1
        from public.user_choice_events e
        where e.user_id = d.user_id
          and e.created_at > a.anchor_at
          and e.created_at <= a.anchor_at + interval '48 hours'
          and e.event_type in (
            'flow_completed',
            'checklist_completed',
            'checklist_partial'
          )
      )
  ) as followup_behavior_window,
  d.payload #> '{output_telemetry}' as output_telemetry,
  coalesce(
    d.payload #>> '{cadence_type}',
    d.payload #>> '{output_telemetry,cadence_type}'
  ) as cadence_type,
  coalesce(
    d.payload #>> '{cadence_mode}',
    d.payload #>> '{output_telemetry,cadence_mode}'
  ) as cadence_mode
from public.maat_guidance_deliveries d
cross join lateral (
  select coalesce(d.acted_at, d.opened_at, d.shown_at, d.created_at) as anchor_at
) a;

grant select on public.maat_guidance_output_truth_loop
  to anon, authenticated, service_role;

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
where r.metadata ? 'output_control';

grant select on public.maat_output_truth_loop
  to anon, authenticated, service_role;

create or replace view public.maat_delivery_recent_events
with (security_invoker = true) as
select
  e.id,
  e.delivery_key,
  e.delivery_kind,
  e.target_table,
  e.target_id,
  e.user_id,
  e.scheduled_for,
  e.cron_picked_at,
  e.function_started_at,
  e.delivered_at,
  e.delivery_latency_seconds,
  case
    when e.delivery_kind in ('reminder', 'scheduled_notification') then 90
    when e.delivery_kind = 'decan_reflection' then 420
    when e.delivery_kind in ('decan_opening', 'drift_nudge', 'strength_nudge')
      then 3600
    else 300
  end as sla_seconds,
  e.cron_job_name,
  e.delivery_attempt,
  e.delivery_status,
  e.skip_reason,
  e.error_code,
  e.metadata,
  e.created_at,
  coalesce(
    e.delivery_latency_seconds >
      case
        when e.delivery_kind in ('reminder', 'scheduled_notification') then 90
        when e.delivery_kind = 'decan_reflection' then 420
        when e.delivery_kind in ('decan_opening', 'drift_nudge', 'strength_nudge')
          then 3600
        else 300
      end,
    false
  ) as is_late,
  e.metadata #>> '{trigger_reason}' as trigger_reason,
  e.metadata #>> '{cadence_type}' as cadence_type,
  e.metadata #>> '{cadence_mode}' as cadence_mode
from public.maat_delivery_timing_events e;

grant select on public.maat_delivery_recent_events to service_role;

create or replace view public.maat_day5_cadence_delivery_proof
with (security_invoker = true) as
select
  d.id as delivery_id,
  d.user_id,
  d.decan_period_key,
  d.kind,
  d.status,
  d.trigger_reason,
  coalesce(
    d.payload #>> '{cadence_type}',
    sent.metadata #>> '{cadence_type}'
  ) as cadence_type,
  coalesce(
    d.payload #>> '{cadence_mode}',
    sent.metadata #>> '{cadence_mode}'
  ) as cadence_mode,
  d.cta_type,
  d.cta_ref,
  d.created_at as generated_at,
  sent.scheduled_for,
  sent.delivered_at,
  sent.delivery_latency_seconds,
  sent.delivery_status,
  sent.cron_job_name
from public.maat_guidance_deliveries d
left join lateral (
  select
    e.scheduled_for,
    e.delivered_at,
    e.delivery_latency_seconds,
    e.delivery_status,
    e.cron_job_name,
    e.metadata
  from public.maat_delivery_timing_events e
  where e.target_table = 'maat_guidance_deliveries'
    and e.target_id = d.id::text
    and e.delivery_status in ('sent', 'skipped')
  order by e.created_at desc
  limit 1
) sent on true
where d.trigger_reason in ('decan_day_5_maat', 'decan_day_5_isfet');

grant select on public.maat_day5_cadence_delivery_proof
  to anon, authenticated, service_role;
