-- Phase 1: compute_flow_outcome with completions (client_event_id + completed_on)

create or replace function public.compute_flow_outcome(p_flow_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow record;
  v_window_start date;
  v_window_end date;
  v_window_start_ts timestamptz;
  v_window_end_ts timestamptz;
  v_events_total integer := 0;
  v_events_completed integer := null;
  v_completed_days integer := 0;
  v_events_completed_ratio numeric := null;
  v_events_completed_confident boolean := false;
  v_scheduled_days integer := 0;
  v_journal_days integer := 0;
  v_badge_count integer := 0;
  v_edit_events integer := 0;
  v_delete_events integer := 0;
  v_reschedule_events integer := 0;
  v_edit_total integer := 0;
  v_has_edit_telemetry boolean := false;
  v_outcome_confidence text := 'low';
  v_accepted_as_is boolean := null;
  v_total_days integer := 0;
  v_schedule_density numeric;
  v_metadata jsonb := '{}'::jsonb;
begin
  select id, user_id, start_date, end_date
  into v_flow
  from public.flows
  where id = p_flow_id
  limit 1;

  if v_flow.id is null then
    raise exception 'Flow % not found', p_flow_id;
  end if;

  if v_flow.user_id is null then
    return;
  end if;

  v_window_start := coalesce(v_flow.start_date, current_date);
  v_window_end := coalesce(v_flow.end_date, current_date);
  if v_window_end < v_window_start then
    v_window_end := v_window_start;
  end if;

  -- UTC timestamp window (no created_at::date truncation)
  v_window_start_ts := (v_window_start::timestamp at time zone 'UTC');
  v_window_end_ts := ((v_window_end + 1)::timestamp at time zone 'UTC');
  v_total_days := (v_window_end - v_window_start) + 1;

  select
    count(*) as total_events,
    count(distinct (ue.starts_at at time zone 'utc')::date) as scheduled_days
  into v_events_total, v_scheduled_days
  from public.user_events ue
  where ue.user_id = v_flow.user_id
    and ue.flow_local_id = p_flow_id
    and ue.starts_at >= v_window_start_ts
    and ue.starts_at < v_window_end_ts;

  -- Journal engagement (date-based)
  select
    count(distinct je.greg_date) as journal_days
  into v_journal_days
  from public.journal_entries je
  where je.user_id = v_flow.user_id
    and je.flow_id = p_flow_id
    and je.greg_date between v_window_start and v_window_end;

  -- Badge count: lower bound until journal_badges has flow_id/occurred_on; join drops rows when entry_id is null.
  select
    count(*) as badge_count
  into v_badge_count
  from public.journal_badges jb
  join public.journal_entries je on je.id = jb.entry_id
  where je.user_id = v_flow.user_id
    and je.flow_id = p_flow_id
    and je.greg_date between v_window_start and v_window_end;

  -- Completions (client_event_id keyed, survives reschedule)
  select
    count(*) as events_completed,
    count(distinct uec.completed_on) as completed_days
  into v_events_completed, v_completed_days
  from public.user_event_completions uec
  where uec.user_id = v_flow.user_id
    and uec.flow_id = p_flow_id
    and uec.completed_on between v_window_start and v_window_end;

  if v_events_total > 0 and v_events_completed is not null then
    v_events_completed_ratio := round((v_events_completed::numeric / v_events_total::numeric), 4);
    -- Require coverage to avoid single-accidental taps: minimum 2 completions and >=60% of scheduled events.
    if v_events_completed >= 2 and v_events_completed_ratio >= 0.6 then
      v_events_completed_confident := true;
    end if;
  end if;

  -- Telemetry: guarded cast for flow_id; only flow-scoped edit/reschedule events
  with ae as (
    select
      ae.event,
      p.flow_id
    from public.app_events ae
    left join lateral (
      select (ae.properties->>'flow_id')::bigint as flow_id
      where (ae.properties ? 'flow_id') and (ae.properties->>'flow_id') ~ '^\d+$'
    ) p on true
    where ae.user_id = v_flow.user_id
      and ae.created_at >= v_window_start_ts
      and ae.created_at < v_window_end_ts
      and ae.event in ('event_updated','event_deleted','flow_rescheduled')
  )
  select
    coalesce(count(*) filter (where event = 'event_updated' and flow_id = p_flow_id), 0),
    coalesce(count(*) filter (where event = 'event_deleted' and flow_id = p_flow_id), 0),
    coalesce(count(*) filter (where event = 'flow_rescheduled' and flow_id = p_flow_id), 0),
    coalesce(count(*) filter (where flow_id = p_flow_id), 0) > 0
  into v_edit_events, v_delete_events, v_reschedule_events, v_has_edit_telemetry
  from ae;

  v_edit_total := coalesce(v_edit_events, 0) + coalesce(v_delete_events, 0) + coalesce(v_reschedule_events, 0);

  if v_has_edit_telemetry then
    v_accepted_as_is := (v_edit_total = 0);
  else
    v_accepted_as_is := null;
  end if;

  if v_total_days > 0 then
    v_schedule_density := round((v_scheduled_days::numeric / v_total_days)::numeric, 4);
  else
    v_schedule_density := null;
  end if;

  -- Outcome confidence:
  -- high: sufficient completion coverage (>=60% and at least 2 completions) on a non-empty schedule
  -- medium: any completion data or, absent that, presence of telemetry
  v_outcome_confidence := 'low';
  if v_events_total > 0 and v_events_completed is not null then
    if v_events_completed > 0 then
      if v_events_completed_confident then
        v_outcome_confidence := 'high';
      else
        v_outcome_confidence := 'medium';
      end if;
    end if;
  end if;
  if v_outcome_confidence = 'low' and v_has_edit_telemetry then
    v_outcome_confidence := 'medium';
  end if;

  v_metadata := jsonb_build_object(
    'scheduled_days', coalesce(v_scheduled_days, 0),
    'badge_count', coalesce(v_badge_count, 0),
    'journal_days', coalesce(v_journal_days, 0),
    'schedule_density', v_schedule_density,
    'events_completed', coalesce(v_events_completed, 0),
    'completed_days', coalesce(v_completed_days, 0),
    'completion_ratio', v_events_completed_ratio,
    'edit_count', coalesce(v_edit_events, 0),
    'delete_count', coalesce(v_delete_events, 0),
    'reschedule_count', coalesce(v_reschedule_events, 0),
    'has_edit_telemetry', v_has_edit_telemetry,
    'outcome_confidence', v_outcome_confidence
  );

  insert into public.flow_outcomes (
    user_id,
    flow_id,
    window_start,
    window_end,
    events_total,
    events_completed,
    edit_count,
    accepted_as_is,
    metadata
  ) values (
    v_flow.user_id,
    p_flow_id,
    v_window_start,
    v_window_end,
    v_events_total,
    v_events_completed,
    v_edit_total,
    v_accepted_as_is,
    v_metadata
  )
  on conflict (user_id, flow_id, window_start) where (window_start is not null)
  do update set
    window_end = excluded.window_end,
    events_total = excluded.events_total,
    events_completed = excluded.events_completed,
    edit_count = excluded.edit_count,
    accepted_as_is = excluded.accepted_as_is,
    metadata = excluded.metadata,
    recorded_at = now();
end;
$$;

comment on function public.compute_flow_outcome(bigint) is
'Phase 1: aggregates schedule, journal/badges, flow-scoped telemetry, and completions (client_event_id + completed_on). High confidence requires completion coverage (>=60%, >=2 completions); accepted_as_is set only when flow-scoped telemetry is present.';

revoke all on function public.compute_flow_outcome(bigint) from public;
grant execute on function public.compute_flow_outcome(bigint) to service_role;
