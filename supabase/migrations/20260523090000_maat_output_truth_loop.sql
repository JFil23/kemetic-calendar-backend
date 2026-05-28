-- Production truth loop for Ma'at guidance outputs.

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
