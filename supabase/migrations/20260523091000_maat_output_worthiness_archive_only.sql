-- Worthiness gating and archive-only delivery support for Ma'at guidance.

alter table public.maat_guidance_deliveries
  drop constraint if exists maat_guidance_deliveries_status_check;

alter table public.maat_guidance_deliveries
  add constraint maat_guidance_deliveries_status_check
  check (
    status = any (
      array[
        'pending'::text,
        'shown'::text,
        'dismissed'::text,
        'opened'::text,
        'acted'::text,
        'expired'::text,
        'archive_only'::text
      ]
    )
  );

create or replace function public.enforce_maat_guidance_delivery_caps()
returns trigger
language plpgsql
as $$
declare
  existing_count integer;
begin
  if new.kind = 'drift_nudge' and new.status <> 'archive_only' then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text || ':' || new.decan_period_key || ':drift_nudge'));

    select count(*)
      into existing_count
      from public.maat_guidance_deliveries d
     where d.user_id = new.user_id
       and d.decan_period_key = new.decan_period_key
       and d.kind = 'drift_nudge'
       and d.status <> 'archive_only'
       and d.id is distinct from new.id;

    if existing_count >= 2 then
      raise exception 'drift_nudge cap reached for this decan'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop view if exists public.maat_output_truth_loop;
drop view if exists public.maat_guidance_output_truth_loop;

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
  d.payload #> '{output_telemetry}' as output_telemetry
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
  null::jsonb as output_control
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
  r.metadata #> '{output_control}' as output_control
from public.reflection_generations r
where r.metadata ? 'output_control';

grant select on public.maat_output_truth_loop
  to anon, authenticated, service_role;
