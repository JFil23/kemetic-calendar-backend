-- Readable activity labels for existing records. No telemetry is rewritten.
-- Reuse the consent-aware RPC owners; only their choice-label expressions change.
-- Existing signatures, volatility, privileges, counts, limits and privacy remain.
create or replace function public.admin_activity_app_event_label(
  p_event text,
  p_properties jsonb default '{}'::jsonb
)
returns text
language sql
immutable
as $$
  select case
    when p_event = 'screen_view' then case p_properties ->> 'route'
      when '/' then 'Viewed Calendar'
      when '/pages' then 'Viewed Pages'
      when '/inbox' then 'Viewed Inbox'
      when '/inbox/conversation/:userId' then 'Viewed a conversation'
      when '/inbox/dm/:conversationId' then 'Viewed a conversation'
      when '/event-invite/:shareId' then 'Viewed an event invitation'
      when '/shared-flow/:shareId' then 'Viewed a shared flow'
      when '/shared-flow/by-flow/:flowId' then 'Viewed a shared flow'
      when '/shared-practice/:roomId' then 'Viewed a shared practice'
      when '/flows' then 'Viewed Flow Studio'
      when '/calendars' then 'Viewed Shared Calendars'
      when '/flows/:flowId/edit' then 'Viewed the flow editor'
      when '/profile/:userId/followers' then 'Viewed profile followers'
      when '/profile/:userId/following' then 'Viewed profile following'
      when '/profile/me/edit' then 'Viewed the profile editor'
      when '/profile-search' then 'Viewed profile search'
      when '/profile/flow-post-picker' then 'Viewed the flow post picker'
      when '/profile/insight-post-picker' then 'Viewed the insight post picker'
      when '/profile/:userId' then 'Viewed a profile'
      when '/insight-post/:postId' then 'Viewed an insight post'
      when '/flow-post/:postId' then 'Viewed a flow post'
      when '/journal' then 'Viewed Journal'
      when '/journal/entry/:entryId' then 'Viewed a journal entry'
      when '/nodes' then 'Viewed Library'
      when '/nodes/:nodeId' then 'Viewed a Library reading'
      when '/reflections' then 'Viewed Reflection Archive'
      when '/reflections/:reflectionId' then 'Viewed a reflection'
      when '/maat-guidance/:deliveryId' then 'Viewed Ma’at guidance'
      when '/settings' then 'Viewed Settings'
      when '/share/:shareId' then 'Viewed a shared flow'
      when '/rhythm/today' then 'Viewed today’s alignment'
      when '/rhythm/todo' then 'Viewed Planner'
      when '/rhythm/tracker' then 'Viewed the commitment tracker'
      when '/rhythm/decan/:dayKey' then 'Viewed a decan review'
      when '/rhythm/editor/timed' then 'Viewed the timed commitment editor'
      when '/rhythm/editor/untimed' then 'Viewed the untimed commitment editor'
      when '/rhythm/editor/custom' then 'Viewed the custom commitment editor'
      when 'calendar_month_detail' then 'Viewed Calendar month details'
      when 'calendar_actions_menu_sheet' then 'Viewed the Calendar menu'
      else 'Viewed screen (name not recorded)'
    end
    when p_event = 'ui_tap' and p_properties ->> 'surface' = 'pages'
      then case p_properties ->> 'target_id'
        when 'pages_calendar' then 'Selected Calendar from Pages'
        when 'pages_studio' then 'Selected Flow Studio from Pages'
        when 'pages_library' then 'Selected Library from Pages'
        when 'pages_feed' then 'Selected the social feed from Pages'
        when 'pages_planner' then 'Selected Planner from Pages'
        when 'pages_journal' then 'Selected Journal from Pages'
        when 'pages_inbox' then 'Selected Inbox from Pages'
        when 'pages_calendars' then 'Selected Shared Calendars from Pages'
        else 'Selected a Pages control (target not recorded)'
      end
    when p_event = 'ui_tap' then 'Selected a control (target not recorded)'
    when p_event = 'rhythm_screen_viewed' then case p_properties ->> 'screen'
      when 'today_alignment' then 'Viewed today’s alignment'
      when 'commitment_tracker' then 'Viewed the commitment tracker'
      else 'Viewed Rhythm (screen not recorded)'
    end
    when p_event = 'calendar_expansion_changed' then case p_properties ->> 'level'
      when 'compact' then 'Showed compact Calendar'
      when 'stacked' then 'Showed stacked Calendar'
      when 'labeled' then 'Showed labeled Calendar'
      when 'details' then 'Showed Calendar details'
      else 'Changed Calendar display'
    end
    when p_event = 'app_open' then 'App opened'
    when p_event = 'telemetry_enabled' then 'Telemetry enabled'
    when p_event = 'journal_opened' then 'Journal opened'
    when p_event = 'journal_autosave' then 'Journal saved'
    when p_event = 'journal_saved' then 'Journal saved'
    when p_event = 'decan_reflection_generated' then 'Reflection generated'
    when p_event = 'note_created' then 'Calendar note created'
    when p_event = 'event_updated' then 'Calendar event updated'
    when p_event = 'event_deleted' then 'Calendar event deleted'
    when p_event = 'flow_rescheduled' then 'Flow rescheduled'
    when p_event = 'share_viewed' then 'Shared flow viewed'
    when p_event = 'flow_imported' then 'Flow imported'
    when p_event = 'flow_import_failed' then 'Flow import failed'
    when p_event = 'rhythm_item_saved' then 'Saved Planner commitment'
    when p_event = 'cycle_field_saved' then 'Saved commitment settings'
    when p_event = 'node_opened' then 'Opened Library reading'
    when p_event = 'node_link_tapped' then 'Followed Library link'
    when p_event = 'node_insight_saved' then 'Saved Library insight'
    when p_event = 'journal_linked_to_node' then 'Linked Journal to Library reading'
    when p_event = 'reflection_linked_to_node' then 'Linked reflection to Library reading'
    when p_event = 'node_linked_to_journal' then 'Linked Library reading to Journal'
    when p_event = 'node_linked_to_reflection' then 'Linked Library reading to reflection'
    when p_event = 'flow_completed' then 'Completed flow'
    when p_event = 'flow_skipped' then 'Skipped flow'
    when p_event = 'reflection_opened' then 'Opened reflection'
    when p_event = 'reflection_saved' then 'Saved reflection'
    when p_event = 'reflection_rated' then 'Rated reflection'
    when p_event = 'checklist_completed' then 'Completed checklist'
    when p_event = 'checklist_partial' then 'Partially completed checklist'
    when p_event = 'checklist_skipped' then 'Skipped checklist'
    when p_event = 'todo_created' then 'Created Planner task'
    when p_event = 'todo_completed' then 'Completed Planner task'
    when p_event = 'suggestion_accepted' then 'Accepted suggestion'
    when p_event = 'suggestion_dismissed' then 'Dismissed suggestion'
    when p_event = 'suggestion_snoozed' then 'Snoozed suggestion'
    when public.admin_activity_app_event_category(p_event) = 'unknown'
      and public.admin_activity_choice_event_category(p_event) = 'unknown' then 'unknown_event'
    else initcap(replace(p_event, '_', ' '))
  end;
$$;

create or replace function public.admin_activity_safe_app_event_fields(
  p_event text,
  p_properties jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v jsonb := coalesce(p_properties, '{}'::jsonb);
  v_chars integer := null;
  v_route text := null;
  v_surface text := null;
  v_target_id text := null;
  v_target_type text := null;
begin
  if (v ->> 'chars') ~ '^[0-9]{1,9}$' then
    v_chars := (v ->> 'chars')::integer;
  end if;

  if p_event = 'screen_view' then
    v_route := nullif(left(coalesce(v ->> 'route', ''), 180), '');
  end if;

  if p_event = 'ui_tap' then
    v_surface := nullif(left(coalesce(v ->> 'surface', ''), 80), '');
    v_target_id := nullif(left(coalesce(v ->> 'target_id', ''), 120), '');
    v_target_type := nullif(left(coalesce(v ->> 'target_type', ''), 40), '');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    -- Presentation keys use only known navigation names, never arbitrary text.
    'navigation_key', case
      when p_event = 'screen_view' and public.admin_activity_app_event_label(p_event, v)
        <> 'Viewed screen (name not recorded)' then v_route
      when p_event = 'rhythm_screen_viewed' then case v ->> 'screen'
        when 'today_alignment' then '/rhythm/today'
        when 'commitment_tracker' then '/rhythm/tracker'
        else null
      end
      else null
    end,
    'context_label', case
      when p_event = 'rhythm_item_saved' and jsonb_typeof(v -> 'is_timed') = 'boolean'
        then case when (v ->> 'is_timed')::boolean then 'Timed commitment' else 'Untimed commitment' end
      when p_event = 'journal_opened' then case v ->> 'entry_point'
        when 'pages' then 'From Pages'
        when 'calendar' then 'From Calendar'
        when 'library' then 'From Library'
        else null
      end
      else null
    end,
    'route', v_route,
    'surface', v_surface,
    'target_id', v_target_id,
    'target_type', v_target_type,
    'entry_point', case
      when p_event in ('journal_opened', 'calendar_expansion_changed')
        then nullif(left(coalesce(v ->> 'entry_point', ''), 80), '')
      else null
    end,
    'presentation', case
      when p_event = 'journal_opened'
        then nullif(left(coalesce(v ->> 'presentation', ''), 40), '')
      else null
    end,
    'orientation', case
      when p_event = 'journal_opened'
        then nullif(left(coalesce(v ->> 'orientation', ''), 40), '')
      else null
    end,
    'level', case
      when p_event = 'calendar_expansion_changed'
        then nullif(left(coalesce(v ->> 'level', ''), 40), '')
      else null
    end,
    'document_mode', case
      when p_event = 'journal_autosave' and jsonb_typeof(v -> 'document_mode') = 'boolean'
        then v -> 'document_mode'
      else null
    end,
    'appended_block', case
      when p_event = 'journal_autosave' and jsonb_typeof(v -> 'appended_block') = 'boolean'
        then v -> 'appended_block'
      else null
    end,
    'char_count', case when p_event = 'journal_autosave' then v_chars else null end,
    'enabled', case
      when p_event = 'telemetry_enabled' and jsonb_typeof(v -> 'enabled') = 'boolean'
        then v -> 'enabled'
      else null
    end,
    'flow_id', case
      when p_event like 'flow_%' and (v ->> 'flow_id') ~ '^[0-9]{1,18}$'
        then (v ->> 'flow_id')::bigint
      else null
    end,
    'detached', case
      when p_event = 'note_created' and jsonb_typeof(v -> 'detached') = 'boolean'
        then v -> 'detached'
      else null
    end,
    'all_day', case
      when p_event = 'note_created' and jsonb_typeof(v -> 'all_day') = 'boolean'
        then v -> 'all_day'
      else null
    end,
    'used_llm', case
      when p_event = 'decan_reflection_generated' and jsonb_typeof(v -> 'used_llm') = 'boolean'
        then v -> 'used_llm'
      else null
    end,
    'renderer', case
      when p_event = 'decan_reflection_generated'
        then nullif(left(coalesce(v ->> 'renderer', ''), 120), '')
      else null
    end
  ));
end;
$$;

create or replace function public.admin_activity_user_detail(
  p_target_user_id uuid,
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
  v_generated_at timestamptz := now();
  v_since timestamptz := now() - make_interval(days => case
    when p_days in (7, 30, 90) then p_days
    when p_days is null then 7
    else least(greatest(p_days, 1), 90)
  end);
  v_profile jsonb := '{}'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_sessions jsonb := '{}'::jsonb;
  v_pages jsonb := '[]'::jsonb;
  v_taps jsonb := '[]'::jsonb;
  v_features jsonb := '[]'::jsonb;
  v_event_counts jsonb := '[]'::jsonb;
  v_timeline jsonb := '[]'::jsonb;
  v_coverage jsonb := '{}'::jsonb;
begin
  if not public.staff_has_scope(auth.uid(), 'product.users.read') then
    raise exception 'product.users.read required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'display_name', coalesce(nullif(p.display_name, ''), nullif(p.handle, ''), nullif(p.email, ''), left(p.id::text, 8)),
    'handle', p.handle,
    'email', p.email,
    'timezone', p.timezone,
    'created_at', p.created_at,
    'telemetry_enabled', p.telemetry_enabled,
    'onboarding_completed_at', p.onboarding_completed_at
  )
  into v_profile
  from public.profiles p
  where p.id = p_target_user_id;

  if v_profile is null then
    return jsonb_build_object(
      'error', 'user_not_found',
      'target_user_id', p_target_user_id
    );
  end if;

  with app_recent as (
    select
      ae.id,
      ae.user_id,
      ae.event,
      ae.properties,
      public.admin_activity_app_event_category(ae.event) as category,
      ae.created_at
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id = p_target_user_id
      and ae.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  choice_recent as (
    select
      uce.id,
      uce.user_id,
      uce.event_type,
      uce.node_id,
      uce.metadata,
      public.admin_activity_choice_event_category(uce.event_type) as category,
      uce.created_at
    from public.user_choice_events uce
    join public.profiles p on p.id = uce.user_id
    where uce.user_id = p_target_user_id
      and uce.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  activity_recent as (
    select user_id, event, category, created_at from app_recent
    union all
    select user_id, event_type as event, category, created_at from choice_recent
  ),
  ordered_activity as (
    select
      user_id,
      created_at,
      lag(created_at) over (partition by user_id order by created_at) as prev_at
    from activity_recent
  ),
  session_stats as (
    select
      count(*) filter (
        where prev_at is null or created_at - prev_at > interval '30 minutes'
      )::integer as session_count,
      coalesce(sum(case
        when prev_at is not null and created_at - prev_at <= interval '30 minutes'
          then least(extract(epoch from created_at - prev_at), 300)
        else 0
      end), 0)::integer as active_seconds
    from ordered_activity
  ),
  journals as (
    select
      count(*) filter (where event like 'journal_%')::integer as journal_event_count,
      count(*) filter (where event = 'journal_opened')::integer as journal_open_count,
      count(*) filter (where event in ('journal_autosave', 'journal_saved'))::integer as journal_save_count
    from app_recent
  ),
  totals as (
    select
      count(*)::integer as event_count,
      min(created_at) as first_seen_at,
      max(created_at) as last_seen_at
    from activity_recent
  ),
  tap_totals as (
    select count(*)::integer as tap_count
    from app_recent
    where event = 'ui_tap'
  ),
  page_totals as (
    select
      count(*)::integer as page_view_count,
      count(distinct nullif(properties ->> 'route', ''))::integer as pages_visited
    from app_recent
    where event = 'screen_view'
  )
  select
    jsonb_build_object(
      'event_count', coalesce(t.event_count, 0),
      'first_seen_at', t.first_seen_at,
      'last_seen_at', t.last_seen_at,
      'page_view_count', coalesce(pg.page_view_count, 0),
      'pages_visited', coalesce(pg.pages_visited, 0),
      'tap_count', coalesce(tt.tap_count, 0),
      'journal_used', coalesce(j.journal_event_count, 0) > 0,
      'journal_open_count', coalesce(j.journal_open_count, 0),
      'journal_save_count', coalesce(j.journal_save_count, 0)
    ),
    jsonb_build_object(
      'basis', 'inferred',
      'session_gap_minutes', 30,
      'active_gap_cap_seconds', 300,
      'session_count', coalesce(ss.session_count, 0),
      'active_seconds', coalesce(ss.active_seconds, 0)
    )
  into v_summary, v_sessions
  from totals t, journals j, session_stats ss, tap_totals tt, page_totals pg;

  with app_recent as (
    select ae.*
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id = p_target_user_id
      and ae.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  screen_events as (
    select
      nullif(ae.properties ->> 'route', '') as route,
      ae.created_at,
      lead(ae.created_at) over (order by ae.created_at) as next_at
    from app_recent ae
    where ae.event = 'screen_view'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'route', route,
    'view_count', view_count,
    'first_seen_at', first_seen_at,
    'last_seen_at', last_seen_at,
    'estimated_seconds', estimated_seconds,
    'basis', 'inferred'
  ) order by view_count desc, last_seen_at desc), '[]'::jsonb)
  into v_pages
  from (
    select
      coalesce(route, '<unknown_route>') as route,
      count(*)::integer as view_count,
      min(created_at) as first_seen_at,
      max(created_at) as last_seen_at,
      coalesce(sum(case
        when next_at is not null and next_at - created_at <= interval '30 minutes'
          then least(extract(epoch from next_at - created_at), 600)
        else 0
      end), 0)::integer as estimated_seconds
    from screen_events
    group by route
    order by view_count desc, last_seen_at desc
    limit 50
  ) rows;

  with app_recent as (
    select ae.*
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id = p_target_user_id
      and ae.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
      and ae.event = 'ui_tap'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'surface', surface,
    'target_id', target_id,
    'target_type', target_type,
    'tap_count', tap_count,
    'first_seen_at', first_seen_at,
    'last_seen_at', last_seen_at,
    'basis', 'observed'
  ) order by tap_count desc, last_seen_at desc), '[]'::jsonb)
  into v_taps
  from (
    select
      coalesce(nullif(properties ->> 'surface', ''), '<unknown_surface>') as surface,
      coalesce(nullif(properties ->> 'target_id', ''), '<unknown_target>') as target_id,
      coalesce(nullif(properties ->> 'target_type', ''), '<unknown_type>') as target_type,
      count(*)::integer as tap_count,
      min(created_at) as first_seen_at,
      max(created_at) as last_seen_at
    from app_recent
    group by surface, target_id, target_type
    order by tap_count desc, last_seen_at desc
    limit 50
  ) rows;

  with app_recent as (
    select
      ae.event,
      public.admin_activity_app_event_category(ae.event) as category,
      ae.created_at
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id = p_target_user_id
      and ae.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  choice_recent as (
    select
      uce.event_type as event,
      public.admin_activity_choice_event_category(uce.event_type) as category,
      uce.created_at
    from public.user_choice_events uce
    join public.profiles p on p.id = uce.user_id
    where uce.user_id = p_target_user_id
      and uce.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  events as (
    select * from app_recent
    union all
    select * from choice_recent
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', category,
        'event_count', event_count,
        'first_seen_at', first_seen_at,
        'last_seen_at', last_seen_at
      ) order by event_count desc, category)
      from (
        select
          category,
          count(*)::integer as event_count,
          min(created_at) as first_seen_at,
          max(created_at) as last_seen_at
        from events
        group by category
      ) categories
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_name', event,
        'category', category,
        'event_count', event_count,
        'first_seen_at', first_seen_at,
        'last_seen_at', last_seen_at
      ) order by event_count desc, last_seen_at desc)
      from (
        select
          event,
          category,
          count(*)::integer as event_count,
          min(created_at) as first_seen_at,
          max(created_at) as last_seen_at
        from events
        group by event, category
        order by event_count desc, last_seen_at desc
        limit 80
      ) event_rows
    ), '[]'::jsonb)
  into v_features, v_event_counts;

  with app_recent as (
    select
      ae.id::text as id,
      ae.event,
      ae.properties,
      public.admin_activity_app_event_category(ae.event) as category,
      ae.created_at
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id = p_target_user_id
      and ae.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  choice_recent as (
    select
      uce.id::text as id,
      uce.event_type,
      uce.metadata,
      uce.node_id,
      public.admin_activity_choice_event_category(uce.event_type) as category,
      uce.created_at
    from public.user_choice_events uce
    join public.profiles p on p.id = uce.user_id
    where uce.user_id = p_target_user_id
      and uce.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  timeline_rows as (
    select
      id,
      created_at,
      'app_events'::text as source_table,
      event as event_name,
      case when category = 'unknown' then 'unknown_event' else event end as canonical_event,
      category,
      public.admin_activity_app_event_label(event, properties) as label,
      'observed'::text as basis,
      public.admin_activity_safe_app_event_fields(event, properties) as safe_fields
    from app_recent
    union all
    select
      cr.id,
      cr.created_at,
      'user_choice_events'::text as source_table,
      cr.event_type as event_name,
      cr.event_type as canonical_event,
      cr.category,
      public.admin_activity_app_event_label(cr.event_type, cr.metadata) as label,
      'observed'::text as basis,
      jsonb_strip_nulls(jsonb_build_object(
        'node_slug', n.slug,
        'node_title', n.title,
        'source_surface', nullif(left(coalesce(cr.metadata ->> 'source_surface', ''), 80), ''),
        'delivery_id', nullif(left(coalesce(cr.metadata ->> 'delivery_id', ''), 80), '')
      )) as safe_fields
    from choice_recent cr
    left join public.nodes n on n.id = cr.node_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'occurred_at', created_at,
    'source_table', source_table,
    'event_name', event_name,
    'canonical_event', canonical_event,
    'category', category,
    'label', label,
    'basis', basis,
    'safe_fields', safe_fields
  ) order by created_at desc), '[]'::jsonb)
  into v_timeline
  from (
    select *
    from timeline_rows
    order by created_at desc
    limit 5000
  ) rows;

  with app_recent as (
    select
      ae.event,
      public.admin_activity_app_event_category(ae.event) as category,
      ae.created_at
    from public.app_events ae
    join public.profiles p on p.id = ae.user_id
    where ae.user_id = p_target_user_id
      and ae.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  totals as (
    select count(*)::integer as total_app_events from app_recent
  ),
  unknown_groups as (
    select event, count(*)::integer as event_count, max(created_at) as last_seen_at
    from app_recent
    where category = 'unknown'
    group by event
  ),
  unknowns as (
    select
      coalesce((select sum(event_count) from unknown_groups), 0)::integer as unknown_event_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'event_name', event,
        'event_count', event_count,
        'last_seen_at', last_seen_at
      ) order by event_count desc, last_seen_at desc), '[]'::jsonb) as unmapped_events
    from (
      select * from unknown_groups
      order by event_count desc, last_seen_at desc, event
      limit 20
    ) rows
  )
  select jsonb_build_object(
    'threshold_rate', 0.10,
    'total_app_events', coalesce(t.total_app_events, 0),
    'unknown_event_count', coalesce(u.unknown_event_count, 0),
    'unknown_event_rate', case
      when coalesce(t.total_app_events, 0) = 0 then 0
      else coalesce(u.unknown_event_count, 0)::numeric / greatest(t.total_app_events, 1)
    end,
    'alert', coalesce(t.total_app_events, 0) > 0
      and (coalesce(u.unknown_event_count, 0)::numeric / greatest(t.total_app_events, 1)) > 0.10,
    'unmapped_events', coalesce(u.unmapped_events, '[]'::jsonb)
  )
  into v_coverage
  from totals t, unknowns u;

  return jsonb_build_object(
    'period_days', v_days,
    'generated_at', v_generated_at,
    'period_start', v_since,
    'profile', v_profile,
    'summary', v_summary,
    'sessions', v_sessions,
    'pages', v_pages,
    'tap_targets', v_taps,
    'features', v_features,
    'event_counts', v_event_counts,
    'timeline', v_timeline,
    'coverage', v_coverage,
    'availability', jsonb_build_object(
      'click_level_data', case
        when coalesce((v_summary ->> 'tap_count')::integer, 0) > 0 then 'observed'
        else 'unavailable_before_ui_tap_instrumentation'
      end,
      'session_time', 'inferred_from_event_gaps',
      'page_time', 'inferred_from_screen_view_sequence',
      'journal_content', 'not_returned'
    ),
    'privacy', jsonb_build_object(
      'raw_properties_returned', false,
      'journal_content_returned', false,
      'reflection_text_returned', false,
      'free_text_returned', false
    )
  );
end;
$$;

create or replace function public.admin_activity_users(
  p_days integer default 7,
  p_limit integer default 100,
  p_query text default null
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
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
  v_generated_at timestamptz := now();
  v_since timestamptz := now() - make_interval(days => case
    when p_days in (7, 30, 90) then p_days
    when p_days is null then 7
    else least(greatest(p_days, 1), 90)
  end);
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_users jsonb := '[]'::jsonb;
  v_total integer := 0;
begin
  if not public.staff_has_scope(auth.uid(), 'product.users.read') then
    raise exception 'product.users.read required' using errcode = '42501';
  end if;

  with filtered_profiles as (
    select p.*
    from public.profiles p
    where v_query is null
      or lower(p.id::text) like '%' || v_query || '%'
      or lower(coalesce(p.email, '')) like '%' || v_query || '%'
      or lower(coalesce(p.display_name, '')) like '%' || v_query || '%'
      or lower(coalesce(p.handle, '')) like '%' || v_query || '%'
  )
  select count(*)::integer into v_total from filtered_profiles;

  with filtered_profiles as (
    select p.*
    from public.profiles p
    where v_query is null
      or lower(p.id::text) like '%' || v_query || '%'
      or lower(coalesce(p.email, '')) like '%' || v_query || '%'
      or lower(coalesce(p.display_name, '')) like '%' || v_query || '%'
      or lower(coalesce(p.handle, '')) like '%' || v_query || '%'
  ),
  app_recent as (
    select
      ae.user_id,
      ae.event,
      public.admin_activity_app_event_category(ae.event) as category,
      ae.created_at
    from public.app_events ae
    join filtered_profiles p on p.id = ae.user_id
    where ae.created_at >= v_since
      and ae.user_id is not null
      and coalesce(p.telemetry_enabled, true) = true
  ),
  choice_recent as (
    select
      uce.user_id,
      uce.event_type as event,
      public.admin_activity_choice_event_category(uce.event_type) as category,
      uce.created_at
    from public.user_choice_events uce
    join filtered_profiles p on p.id = uce.user_id
    where uce.created_at >= v_since
      and coalesce(p.telemetry_enabled, true) = true
  ),
  activity_recent as (
    select * from app_recent
    union all
    select * from choice_recent
  ),
  ordered_activity as (
    select
      user_id,
      created_at,
      lag(created_at) over (partition by user_id order by created_at) as prev_at
    from activity_recent
  ),
  sessions as (
    select
      user_id,
      count(*) filter (
        where prev_at is null or created_at - prev_at > interval '30 minutes'
      )::integer as session_count,
      coalesce(sum(case
        when prev_at is not null and created_at - prev_at <= interval '30 minutes'
          then least(extract(epoch from created_at - prev_at), 300)
        else 0
      end), 0)::integer as active_seconds
    from ordered_activity
    group by user_id
  ),
  last_activity as (
    select
      user_id,
      count(*)::integer as event_count,
      min(created_at) as first_seen_at,
      max(created_at) as last_seen_at
    from activity_recent
    group by user_id
  ),
  pages as (
    select
      ae.user_id,
      count(*)::integer as page_view_count,
      count(distinct nullif(ae.properties ->> 'route', ''))::integer as pages_visited
    from public.app_events ae
    join filtered_profiles p on p.id = ae.user_id
    where ae.created_at >= v_since
      and ae.event = 'screen_view'
      and coalesce(p.telemetry_enabled, true) = true
    group by ae.user_id
  ),
  taps as (
    select
      ae.user_id,
      count(*)::integer as tap_count,
      count(distinct nullif(ae.properties ->> 'target_id', ''))::integer as tracked_targets
    from public.app_events ae
    join filtered_profiles p on p.id = ae.user_id
    where ae.created_at >= v_since
      and ae.event = 'ui_tap'
      and coalesce(p.telemetry_enabled, true) = true
    group by ae.user_id
  ),
  journals as (
    select
      user_id,
      count(*) filter (where event like 'journal_%')::integer as journal_event_count,
      count(*) filter (where event = 'journal_opened')::integer as journal_open_count,
      count(*) filter (where event in ('journal_autosave', 'journal_saved'))::integer as journal_save_count
    from app_recent
    group by user_id
  ),
  features as (
    select
      user_id,
      jsonb_agg(
        jsonb_build_object('category', category, 'count', event_count)
        order by event_count desc, category
      ) as top_features
    from (
      select user_id, category, count(*)::integer as event_count
      from activity_recent
      group by user_id, category
    ) grouped
    group by user_id
  ),
  app_totals as (
    select user_id, count(*)::integer as total_app_events
    from app_recent group by user_id
  ),
  unknowns as (
    select user_id, count(*)::integer as unknown_event_count
    from app_recent
    where category = 'unknown'
    group by user_id
  ),
  latest_event as (
    select distinct on (src.user_id)
      src.user_id,
      src.created_at as last_event_at,
      src.label as last_event_label
    from (
      select
        ae.user_id,
        ae.created_at,
        public.admin_activity_app_event_label(ae.event, coalesce(ae.properties, '{}'::jsonb)) as label
      from public.app_events ae
      join filtered_profiles p on p.id = ae.user_id
      where ae.user_id is not null
        and coalesce(p.telemetry_enabled, true) = true
      union all
      select
        uce.user_id,
        uce.created_at,
        public.admin_activity_app_event_label(uce.event_type, uce.metadata) as label
      from public.user_choice_events uce
      join filtered_profiles p on p.id = uce.user_id
      where coalesce(p.telemetry_enabled, true) = true
    ) src
    order by src.user_id, src.created_at desc
  ),
  ranked_profiles as (
    select p.*
    from filtered_profiles p
    left join last_activity la on la.user_id = p.id
    order by la.last_seen_at desc nulls last, p.created_at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'node_id', p.id::text,
    'display_name', coalesce(nullif(p.display_name, ''), nullif(p.handle, ''), nullif(p.email, ''), left(p.id::text, 8)),
    'handle', p.handle,
    'email', p.email,
    'timezone', p.timezone,
    'created_at', p.created_at,
    'telemetry_enabled', p.telemetry_enabled,
    'first_seen_at', la.first_seen_at,
    'last_seen_at', la.last_seen_at,
    'last_event_at', le.last_event_at,
    'last_event_label', le.last_event_label,
    'event_count', coalesce(la.event_count, 0),
    'session_count', coalesce(s.session_count, 0),
    'active_seconds', coalesce(s.active_seconds, 0),
    'pages_visited', coalesce(pg.pages_visited, 0),
    'page_view_count', coalesce(pg.page_view_count, 0),
    'tap_count', coalesce(t.tap_count, 0),
    'tracked_targets', coalesce(t.tracked_targets, 0),
    'journal_used', coalesce(j.journal_event_count, 0) > 0,
    'journal_open_count', coalesce(j.journal_open_count, 0),
    'journal_save_count', coalesce(j.journal_save_count, 0),
    'unknown_event_count', coalesce(u.unknown_event_count, 0),
    'coverage_alert', coalesce(u.unknown_event_count, 0) > 0
      and coalesce(at.total_app_events, 0) > 0
      and (coalesce(u.unknown_event_count, 0)::numeric / greatest(at.total_app_events, 1)) > 0.10,
    'top_features', coalesce(f.top_features, '[]'::jsonb)
  ) order by la.last_seen_at desc nulls last, p.created_at desc), '[]'::jsonb)
  into v_users
  from ranked_profiles p
  left join last_activity la on la.user_id = p.id
  left join sessions s on s.user_id = p.id
  left join pages pg on pg.user_id = p.id
  left join taps t on t.user_id = p.id
  left join journals j on j.user_id = p.id
  left join features f on f.user_id = p.id
  left join app_totals at on at.user_id = p.id
  left join unknowns u on u.user_id = p.id
  left join latest_event le on le.user_id = p.id;

  return jsonb_build_object(
    'period_days', v_days,
    'generated_at', v_generated_at,
    'period_start', v_since,
    'limit', v_limit,
    'query', v_query,
    'total_matching_users', v_total,
    'users', v_users,
    'privacy', jsonb_build_object(
      'raw_properties_returned', false,
      'journal_content_returned', false,
      'free_text_returned', false
    )
  );
end;
$$;
