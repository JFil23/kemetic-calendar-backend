begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

-- pg_cron retains every run record indefinitely. Keep the operational window
-- needed by the delivery health view while preventing this extension-owned
-- diagnostic table from growing without bound.
create or replace function private.prune_cron_job_run_details()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleted bigint;
begin
  delete from cron.job_run_details run
  where run.start_time < clock_timestamp() - interval '14 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.prune_cron_job_run_details()
  from public, anon, authenticated;
grant execute on function private.prune_cron_job_run_details()
  to service_role;

-- Integrate the narrow pg_cron cleanup into the existing once-daily bounded
-- history job. All pre-existing retention behavior remains byte-for-byte
-- equivalent apart from the additional result field.
create or replace function private.prune_bounded_history()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_delivery_events bigint;
  v_delivery_ledger bigint;
  v_snapshots bigint;
  v_evaluations bigint;
  v_app_events bigint;
  v_audit_rows bigint;
  v_deliveries bigint;
  v_generations bigint;
  v_reflections bigint;
  v_profile_facts bigint;
  v_restoration_windows bigint;
  v_cron_job_run_details bigint;
begin
  delete from public.maat_delivery_timing_events event
  where event.created_at < clock_timestamp() - interval '14 days';
  get diagnostics v_delivery_events = row_count;

  delete from public.maat_delivery_ledger ledger
  where ledger.last_event_at < clock_timestamp() - interval '90 days';
  get diagnostics v_delivery_ledger = row_count;

  delete from public.maat_guidance_evaluations evaluation
  where evaluation.created_at < clock_timestamp() - interval '90 days';
  get diagnostics v_evaluations = row_count;

  delete from public.maat_snapshots snapshot
  where snapshot.window_date < current_date - 90;
  get diagnostics v_snapshots = row_count;

  delete from public.maat_guidance_deliveries delivery
  where delivery.status in ('archive_only', 'expired', 'dismissed', 'acted')
    and delivery.updated_at < clock_timestamp() - interval '30 days';
  get diagnostics v_deliveries = row_count;

  delete from public.reflection_generations generation
  where generation.created_at < clock_timestamp() - interval '30 days'
    and not exists (
      select 1
      from public.maat_guidance_deliveries delivery
      where delivery.generation_id = generation.id
    )
    and not exists (
      select 1
      from public.reflection_feedback feedback
      where feedback.reflection_generation_id = generation.id
    );
  get diagnostics v_generations = row_count;

  delete from public.decan_reflections reflection
  where reflection.created_at < clock_timestamp() - interval '30 days';
  get diagnostics v_reflections = row_count;

  with ranked as (
    select fact.id,
      row_number() over (
        partition by fact.user_id
        order by fact.last_seen desc, fact.id
      ) as retained_rank
    from public.maat_user_profile_facts fact
  )
  delete from public.maat_user_profile_facts fact
  using ranked
  where fact.id = ranked.id
    and (
      fact.last_seen < clock_timestamp() - interval '90 days'
      or ranked.retained_rank > 64
    );
  get diagnostics v_profile_facts = row_count;

  with ranked as (
    select snapshot.user_id,
      snapshot.scope,
      snapshot.device_id,
      snapshot.window_id,
      snapshot.updated_at,
      row_number() over (
        partition by snapshot.user_id, snapshot.device_id
        order by snapshot.updated_at desc, snapshot.window_id
      ) as retained_rank
    from public.user_app_restoration_snapshots snapshot
    where snapshot.scope = 'window'
  )
  delete from public.user_app_restoration_snapshots snapshot
  using ranked
  where snapshot.user_id = ranked.user_id
    and snapshot.scope = ranked.scope
    and snapshot.device_id = ranked.device_id
    and snapshot.window_id = ranked.window_id
    and (
      ranked.updated_at < clock_timestamp() - interval '30 days'
      or ranked.retained_rank > 3
    );
  get diagnostics v_restoration_windows = row_count;

  delete from public.app_events event
  where event.created_at < clock_timestamp() - interval '30 days';
  get diagnostics v_app_events = row_count;

  delete from public.audit_log audit
  where audit.at < clock_timestamp() - interval '90 days';
  get diagnostics v_audit_rows = row_count;

  v_cron_job_run_details := private.prune_cron_job_run_details();

  return jsonb_build_object(
    'delivery_events', v_delivery_events,
    'delivery_ledger', v_delivery_ledger,
    'maat_snapshots', v_snapshots,
    'maat_guidance_evaluations', v_evaluations,
    'maat_guidance_deliveries', v_deliveries,
    'reflection_generations', v_generations,
    'decan_reflections', v_reflections,
    'maat_user_profile_facts', v_profile_facts,
    'restoration_windows', v_restoration_windows,
    'app_events', v_app_events,
    'audit_log', v_audit_rows,
    'cron_job_run_details', v_cron_job_run_details
  );
end;
$$;

revoke all on function private.prune_bounded_history()
  from public, anon, authenticated;
grant execute on function private.prune_bounded_history() to service_role;

commit;
