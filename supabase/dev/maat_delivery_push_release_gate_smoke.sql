begin;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  scheduled_for,
  function_started_at,
  delivered_at,
  cron_job_name,
  delivery_status,
  metadata
) values
  (
    'smoke:push-release:safe',
    'strength_nudge',
    'maat_guidance_deliveries',
    'smoke-safe',
    now(),
    now(),
    now(),
    'smoke_push_release_gate',
    'sent',
    jsonb_build_object(
      'package_version', 'compiled_output_package_v1',
      'compiler_status', 'compiled',
      'push_source', 'compiled_package.push_text',
      'push_blocked', false
    )
  ),
  (
    'smoke:push-release:legacy',
    'strength_nudge',
    'maat_guidance_deliveries',
    'smoke-legacy',
    now(),
    now(),
    now(),
    'smoke_push_release_gate',
    'sent',
    jsonb_build_object(
      'package_version', 'compiled_output_package_v1',
      'compiler_status', 'compiled',
      'push_source', 'legacy_body_excerpt',
      'push_blocked', false
    )
  ),
  (
    'smoke:push-release:fallback-blocked',
    'decan_reflection',
    'decan_reflection_schedule',
    'smoke-fallback-blocked',
    now(),
    now(),
    now(),
    'smoke_push_release_gate',
    'skipped',
    jsonb_build_object(
      'package_version', 'compiled_output_package_v1',
      'compiler_status', 'fallback',
      'push_source', 'blocked_fallback',
      'push_blocked', true,
      'push_block_reason', 'compiled_package_not_quality_proof'
    )
  ),
  (
    'smoke:push-release:fallback-not-blocked',
    'decan_reflection',
    'decan_reflection_schedule',
    'smoke-fallback-not-blocked',
    now(),
    now(),
    now(),
    'smoke_push_release_gate',
    'sent',
    jsonb_build_object(
      'package_version', 'compiled_output_package_v1',
      'compiler_status', 'fallback',
      'push_source', 'compiled_package.push_text',
      'push_blocked', false
    )
  );

do $$
declare
  v_blockers integer;
  v_safe_rows integer;
begin
  select count(*)
    into v_safe_rows
  from public.maat_delivery_recent_events
  where delivery_key = 'smoke:push-release:safe'
    and package_version = 'compiled_output_package_v1'
    and compiler_status = 'compiled'
    and push_source = 'compiled_package.push_text'
    and push_blocked = false;

  if v_safe_rows <> 1 then
    raise exception 'expected safe compiled push row in recent events, got %',
      v_safe_rows;
  end if;

  select count(*)
    into v_blockers
  from public.maat_delivery_push_release_blockers
  where delivery_key like 'smoke:push-release:%';

  if v_blockers <> 2 then
    raise exception 'expected 2 push release blockers, got %', v_blockers;
  end if;
end $$;

rollback;
