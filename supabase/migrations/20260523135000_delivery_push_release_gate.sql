-- Release gate for compiler-owned push delivery.
-- Expected result from maat_delivery_push_release_blockers is always zero rows.

drop view if exists public.maat_delivery_push_release_blockers;

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
  e.metadata #>> '{cadence_mode}' as cadence_mode,
  coalesce(
    e.metadata #>> '{compiler_status}',
    d.payload #>> '{output_compiler,status}',
    d.payload #>> '{compiled_output_package,compiler,status}',
    d.payload #>> '{output_control,outputCompiler,status}',
    d.payload #>> '{output_control,output_compiler,status}',
    d.payload #>> '{output_control,compiledOutputPackage,compiler,status}',
    d.payload #>> '{output_control,compiled_output_package,compiler,status}'
  ) as compiler_status,
  coalesce(
    e.metadata #>> '{package_version}',
    e.metadata #>> '{compiled_package_version}',
    d.payload #>> '{compiled_output_package,package_version}',
    d.payload #>> '{output_control,compiledOutputPackage,package_version}',
    d.payload #>> '{output_control,compiled_output_package,package_version}'
  ) as package_version,
  e.metadata #>> '{push_source}' as push_source,
  case
    when lower(coalesce(e.metadata #>> '{push_blocked}', 'false'))
      in ('true', 't', '1', 'yes') then true
    else false
  end as push_blocked,
  coalesce(
    e.metadata #>> '{push_block_reason}',
    case
      when e.skip_reason in (
        'compiled_package_not_quality_proof',
        'compiled_package_missing_push_text'
      ) then e.skip_reason
      else null
    end
  ) as push_block_reason
from public.maat_delivery_timing_events e
left join public.maat_guidance_deliveries d
  on e.target_table = 'maat_guidance_deliveries'
  and d.id::text = e.target_id;

comment on view public.maat_delivery_recent_events is
'Recent delivery timing events with compiler-owned push metadata promoted from event metadata and guidance payloads.';

grant select on public.maat_delivery_recent_events to service_role;

create or replace view public.maat_delivery_push_release_blockers
with (security_invoker = true) as
select
  delivery_kind,
  delivery_key,
  compiler_status,
  package_version,
  push_source,
  push_blocked,
  push_block_reason,
  created_at
from public.maat_delivery_recent_events
where package_version = 'compiled_output_package_v1'
  and (
    push_source like 'legacy\_%' escape '\'
    or push_source in (
      'legacy_excerpt',
      'legacy_teaser',
      'derived_body',
      'legacy_body_excerpt',
      'legacy_push_text',
      'legacy_teaser_text'
    )
    or (
      compiler_status = 'fallback'
      and coalesce(push_blocked, false) = false
    )
    or (
      push_source = 'compiled_package_missing_push_text'
      and coalesce(push_blocked, false) = false
    )
    or (
      push_source = 'compiled_package.push_text'
      and coalesce(push_blocked, false) = true
    )
  )
order by created_at desc;

comment on view public.maat_delivery_push_release_blockers is
'Zero-row release gate: compiler-owned outputs must not use legacy push text, fallback packages must not push, and missing push_text must block.';

grant select on public.maat_delivery_push_release_blockers to service_role;
