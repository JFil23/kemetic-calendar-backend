-- ḥꜣw Admin / Operator Console - Phase 2
-- Read-only War Room aggregate RPC.

create or replace function public.admin_war_room_summary(
  p_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := case
    when p_days in (7, 30, 90) then p_days
    when p_days is null then 7
    else least(greatest(p_days, 1), 90)
  end;
  v_min_bucket integer := 5;
  v_generated_at timestamptz := now();
  v_since timestamptz := now() - make_interval(days => case
    when p_days in (7, 30, 90) then p_days
    when p_days is null then 7
    else least(greatest(p_days, 1), 90)
  end);
  v_period_start timestamptz := v_since;
  v_users jsonb := '{}'::jsonb;
  v_activation jsonb := '{}'::jsonb;
  v_maat_outcomes jsonb := '[]'::jsonb;
  v_maat_alerts jsonb := '[]'::jsonb;
  v_maat_source text := null;
  v_nodes_top jsonb := '[]'::jsonb;
  v_nodes_bottom jsonb := '[]'::jsonb;
  v_flows jsonb := '{}'::jsonb;
  v_app_error_events jsonb := '[]'::jsonb;
  v_flow_generation_errors jsonb := '[]'::jsonb;
  v_empty_sections text[] := '{}'::text[];
begin
  if not public.staff_has_scope(auth.uid(), 'war_room.read') then
    raise exception 'war_room.read required' using errcode = '42501';
  end if;

  with telemetry_events as (
    select ae.user_id, ae.created_at
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id is not null
      and coalesce(p.telemetry_enabled, true) = true
  )
  select jsonb_build_object(
    'active_period', coalesce(count(distinct user_id) filter (
      where created_at >= v_since
    ), 0),
    'active_7d', coalesce(count(distinct user_id) filter (
      where created_at >= v_generated_at - interval '7 days'
    ), 0),
    'active_30d', coalesce(count(distinct user_id) filter (
      where created_at >= v_generated_at - interval '30 days'
    ), 0),
    'new_period', (
      select count(*)
      from public.profiles p
      where p.created_at >= v_since
    ),
    'new_7d', (
      select count(*)
      from public.profiles p
      where p.created_at >= v_generated_at - interval '7 days'
    ),
    'new_30d', (
      select count(*)
      from public.profiles p
      where p.created_at >= v_generated_at - interval '30 days'
    ),
    'onboarding_completed_period', (
      select count(*)
      from public.profiles p
      where p.onboarding_completed_at >= v_since
    ),
    'onboarding_completed_total', (
      select count(*)
      from public.profiles p
      where p.onboarding_completed_at is not null
    ),
    'total_profiles', (
      select count(*)
      from public.profiles p
    )
  )
  into v_users
  from telemetry_events;

  with first_node as (
    select uce.user_id, min(uce.created_at) as first_at
    from public.user_choice_events uce
    join public.profiles p on p.id = uce.user_id
    where uce.event_type = 'node_opened'
      and coalesce(p.telemetry_enabled, true) = true
    group by uce.user_id
  ),
  first_flow as (
    select f.user_id, min(f.created_at) as first_at
    from public.flows f
    join public.profiles p on p.id = f.user_id
    where f.user_id is not null
      and coalesce(f.is_reminder, false) = false
      and coalesce(f.is_hidden, false) = false
      and coalesce(p.telemetry_enabled, true) = true
    group by f.user_id
  ),
  first_journal as (
    select ae.user_id, min(ae.created_at) as first_at
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id is not null
      and ae.event like 'journal_%'
      and coalesce(p.telemetry_enabled, true) = true
    group by ae.user_id
  ),
  first_reflection as (
    select uce.user_id, min(uce.created_at) as first_at
    from public.user_choice_events uce
    join public.profiles p on p.id = uce.user_id
    where uce.event_type in (
      'reflection_opened',
      'reflection_saved',
      'reflection_rated'
    )
      and coalesce(p.telemetry_enabled, true) = true
    group by uce.user_id
  )
  select jsonb_build_object(
    'first_node_opened_period', (
      select count(*) from first_node where first_at >= v_since
    ),
    'first_flow_started_period', (
      select count(*) from first_flow where first_at >= v_since
    ),
    'first_journal_action_period', (
      select count(*) from first_journal where first_at >= v_since
    ),
    'first_reflection_action_period', (
      select count(*) from first_reflection where first_at >= v_since
    )
  )
  into v_activation;

  if to_regclass('public.maat_guidance_drift_outcome_dashboard') is not null then
    v_maat_source := 'maat_guidance_drift_outcome_dashboard';

    execute $sql$
      select coalesce(jsonb_agg(jsonb_build_object(
        'cta_type', cta_type,
        'cta_ref', cta_ref,
        'outcome_flag', outcome_flag,
        'routing_effect', routing_effect,
        'measured_week_count', measured_week_count,
        'completed_window_count', completed_window_count,
        'positive_week_count', positive_week_count,
        'negative_week_count', negative_week_count,
        'weighted_delta_done_rate', weighted_delta_done_rate,
        'weighted_delta_skipped_rate', weighted_delta_skipped_rate,
        'latest_measured_week', latest_measured_week,
        'flag_rule', flag_rule
      ) order by
        case outcome_flag
          when 'negative' then 0
          when 'winning' then 1
          else 2
        end,
        completed_window_count desc,
        latest_measured_week desc nulls last
      ), '[]'::jsonb)
      from (
        select *
        from public.maat_guidance_drift_outcome_dashboard
        where coalesce(completed_window_count, 0) >= $1
        order by latest_measured_week desc nulls last
        limit 20
      ) d
    $sql$
    into v_maat_outcomes
    using v_min_bucket;
  end if;

  if to_regclass('public.maat_guidance_ops_alerts') is not null then
    execute $sql$
      select coalesce(jsonb_agg(jsonb_build_object(
        'alert_key', alert_key,
        'severity', severity,
        'cta_type', cta_type,
        'cta_ref', cta_ref,
        'cohort_type', cohort_type,
        'cohort_key', cohort_key,
        'details', details
      ) order by severity desc, alert_key), '[]'::jsonb)
      from (
        select *
        from public.maat_guidance_ops_alerts
        limit 10
      ) alerts
    $sql$
    into v_maat_alerts;
  end if;

  with node_events as (
    select
      n.slug,
      n.title,
      n.glyph,
      count(*)::integer as event_count,
      count(distinct uce.user_id)::integer as distinct_users,
      max(uce.created_at) as last_event_at
    from public.user_choice_events uce
    join public.profiles p on p.id = uce.user_id
    left join public.nodes n on n.id = uce.node_id
    where uce.created_at >= v_since
      and uce.event_type in (
        'node_opened',
        'node_link_tapped',
        'node_insight_saved'
      )
      and coalesce(p.telemetry_enabled, true) = true
    group by n.slug, n.title, n.glyph
  ),
  eligible as (
    select *
    from node_events
    where distinct_users >= v_min_bucket
      and slug is not null
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', slug,
        'title', title,
        'glyph', glyph,
        'event_count', event_count,
        'distinct_users', distinct_users,
        'last_event_at', last_event_at
      ) order by event_count desc, last_event_at desc)
      from (
        select *
        from eligible
        order by event_count desc, last_event_at desc
        limit 10
      ) top_rows
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', slug,
        'title', title,
        'glyph', glyph,
        'event_count', event_count,
        'distinct_users', distinct_users,
        'last_event_at', last_event_at
      ) order by event_count asc, last_event_at desc)
      from (
        select *
        from eligible
        order by event_count asc, last_event_at desc
        limit 10
      ) bottom_rows
    ), '[]'::jsonb)
  into v_nodes_top, v_nodes_bottom;

  with flow_choice_events as (
    select uce.event_type, uce.user_id, uce.created_at
    from public.user_choice_events uce
    join public.profiles p on p.id = uce.user_id
    where uce.created_at >= v_since
      and uce.event_type in ('flow_completed', 'flow_skipped')
      and coalesce(p.telemetry_enabled, true) = true
  ),
  flow_creates as (
    select f.user_id, f.created_at
    from public.flows f
    join public.profiles p on p.id = f.user_id
    where f.created_at >= v_since
      and f.user_id is not null
      and coalesce(f.is_reminder, false) = false
      and coalesce(f.is_hidden, false) = false
      and coalesce(p.telemetry_enabled, true) = true
  ),
  ai_generations as (
    select fgl.user_id, fgl.llm_status, fgl.created_at
    from public.flow_generation_logs fgl
    join public.profiles p on p.id = fgl.user_id
    where fgl.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  )
  select jsonb_build_object(
    'created_period', (select count(*) from flow_creates),
    'created_users_period', (select count(distinct user_id) from flow_creates),
    'completed_events_period', (
      select count(*) from flow_choice_events where event_type = 'flow_completed'
    ),
    'completed_users_period', (
      select count(distinct user_id) from flow_choice_events where event_type = 'flow_completed'
    ),
    'skipped_events_period', (
      select count(*) from flow_choice_events where event_type = 'flow_skipped'
    ),
    'skipped_users_period', (
      select count(distinct user_id) from flow_choice_events where event_type = 'flow_skipped'
    ),
    'ai_generations_period', (select count(*) from ai_generations),
    'ai_success_period', (
      select count(*)
      from ai_generations
      where llm_status in (
        'success',
        'retry_success',
        'planner_first_success',
        'planner_first_retry_success',
        'long_flow_success',
        'cache_hit'
      )
        or llm_status like 'cache_hit%'
    ),
    'ai_failure_period', (
      select count(*)
      from ai_generations
      where llm_status is not null
        and llm_status not in (
          'success',
          'retry_success',
          'planner_first_success',
          'planner_first_retry_success',
          'long_flow_success',
          'cache_hit'
        )
        and llm_status not like 'cache_hit%'
    )
  )
  into v_flows;

  with app_errors as (
    select
      ae.event,
      count(*)::integer as event_count,
      count(distinct ae.user_id)::integer as distinct_users,
      max(ae.created_at) as last_seen_at
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.created_at >= v_since
      and ae.user_id is not null
      and coalesce(p.telemetry_enabled, true) = true
      and (
        ae.event ilike '%error%'
        or ae.event ilike '%failed%'
        or coalesce(ae.properties::text, '') ilike '%error%'
        or coalesce(ae.properties::text, '') ilike '%failed%'
      )
    group by ae.event
    having count(distinct ae.user_id) >= v_min_bucket
  ),
  flow_generation_failures as (
    select
      fgl.llm_status,
      count(*)::integer as event_count,
      count(distinct fgl.user_id)::integer as distinct_users,
      max(fgl.created_at) as last_seen_at
    from public.flow_generation_logs fgl
    join public.profiles p on p.id = fgl.user_id
    where fgl.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
      and fgl.llm_status is not null
      and fgl.llm_status not in (
        'success',
        'retry_success',
        'planner_first_success',
        'planner_first_retry_success',
        'long_flow_success',
        'cache_hit'
      )
      and fgl.llm_status not like 'cache_hit%'
    group by fgl.llm_status
    having count(distinct fgl.user_id) >= v_min_bucket
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', event,
        'event_count', event_count,
        'distinct_users', distinct_users,
        'last_seen_at', last_seen_at
      ) order by event_count desc, last_seen_at desc)
      from app_errors
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'llm_status', llm_status,
        'event_count', event_count,
        'distinct_users', distinct_users,
        'last_seen_at', last_seen_at
      ) order by event_count desc, last_seen_at desc)
      from flow_generation_failures
    ), '[]'::jsonb)
  into v_app_error_events, v_flow_generation_errors;

  if jsonb_array_length(v_maat_outcomes) = 0 then
    v_empty_sections := array_append(v_empty_sections, 'maat');
  end if;
  if jsonb_array_length(v_nodes_top) = 0 then
    v_empty_sections := array_append(v_empty_sections, 'nodes');
  end if;
  if coalesce((v_flows ->> 'created_period')::integer, 0) = 0
    and coalesce((v_flows ->> 'completed_events_period')::integer, 0) = 0
    and coalesce((v_flows ->> 'ai_generations_period')::integer, 0) = 0 then
    v_empty_sections := array_append(v_empty_sections, 'flows');
  end if;
  if jsonb_array_length(v_app_error_events) = 0
    and jsonb_array_length(v_flow_generation_errors) = 0 then
    v_empty_sections := array_append(v_empty_sections, 'errors');
  end if;

  return jsonb_build_object(
    'period_days', v_days,
    'generated_at', v_generated_at,
    'period_start', v_period_start,
    'min_bucket_size', v_min_bucket,
    'users', v_users,
    'activation', v_activation,
    'maat', jsonb_build_object(
      'outcomes', v_maat_outcomes,
      'alerts', v_maat_alerts,
      'source', v_maat_source
    ),
    'nodes', jsonb_build_object(
      'top', v_nodes_top,
      'bottom', v_nodes_bottom,
      'min_bucket_size', v_min_bucket
    ),
    'flows', v_flows,
    'errors', jsonb_build_object(
      'app_events', v_app_error_events,
      'flow_generation', v_flow_generation_errors,
      'min_bucket_size', v_min_bucket
    ),
    'empty_sections', to_jsonb(v_empty_sections)
  );
end;
$$;

revoke all on function public.admin_war_room_summary(integer) from public;
grant execute on function public.admin_war_room_summary(integer)
  to authenticated, service_role;
