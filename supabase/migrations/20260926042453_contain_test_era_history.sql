begin;

-- Cut 14 pivot: the pre-launch generated history is disposable. Preserve the
-- product schema and live writer behavior, reset only the authorized derived
-- and diagnostic relations, and bound their future growth.
set local lock_timeout = '15s';
set local statement_timeout = '5min';

-- Scheduled Ma'at work is limited to people who have used the app recently
-- or who currently have an active push token. The function is service-role
-- only; clients cannot enumerate account ids through the Data API.
create or replace function public.active_maat_user_ids(
  p_since timestamp with time zone
)
returns table (user_id uuid)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select distinct event.user_id
  from public.app_events event
  where event.user_id is not null
    and event.created_at >= p_since

  union

  select distinct token.user_id
  from public.push_tokens token
  where token.is_active
    and token.user_id is not null;
$$;

revoke all on function public.active_maat_user_ids(timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.active_maat_user_ids(timestamp with time zone)
  to service_role;

-- Keep operationally useful recent diagnostics without recreating the old
-- unbounded history. This function is private and runs once per day via cron.
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
    'audit_log', v_audit_rows
  );
end;
$$;

revoke all on function private.prune_bounded_history()
  from public, anon, authenticated;
grant execute on function private.prune_bounded_history() to service_role;

-- Stop duplicating ordinary product and telemetry inserts into the legacy
-- full-row audit table. Profile accountability remains bounded separately;
-- admin actions continue to use public.admin_audit_log unchanged.
drop trigger if exists trg_audit_app_events on public.app_events;
drop trigger if exists trg_audit_user_events on public.user_events;
drop trigger if exists trg_audit_flows on public.flows;

-- This trigger exists only to populate the development-only debug relation.
drop trigger if exists trg_log_flow_inserts on public.flows;

-- Reset delivery telemetry and the abandoned historical backfill. The live
-- INSERT trigger on maat_delivery_timing_events is deliberately retained.
truncate table
  public.maat_delivery_timing_events,
  public.maat_delivery_ledger,
  private.maat_delivery_ledger_live_event_ids,
  private.maat_delivery_ledger_backfill_batch;

truncate table private.maat_delivery_ledger_backfill_state;

insert into private.maat_delivery_ledger_backfill_state (
  singleton,
  installed_at,
  backfill_started_at,
  backfill_completed_at,
  baseline_raw_events_added,
  baseline_delivery_keys_added,
  backfill_cursor_delivery_key,
  backfill_batches_completed,
  last_batch_started_at,
  last_batch_completed_at,
  last_batch_delivery_keys,
  last_batch_raw_events
) values (
  true,
  clock_timestamp(),
  clock_timestamp(),
  clock_timestamp(),
  0,
  0,
  null,
  0,
  null,
  null,
  null,
  null
);

-- Every relation below is generated or derived. Listing the full FK closure
-- makes the destructive scope explicit and avoids TRUNCATE ... CASCADE.
truncate table
  public.reflection_feedback,
  public.maat_flow_briefs,
  public.maat_restoration_attempts,
  public.maat_band_transitions,
  public.maat_corrections,
  public.maat_guidance_evaluations,
  public.maat_guidance_deliveries,
  public.maat_snapshots,
  public.reflection_generations,
  public.decan_reflections,
  public.reflection_profiles,
  public.maat_user_profile_facts,
  public.maat_user_baselines,
  public.maat_obligations,
  public.maat_delivery_receipt_events;

truncate table public.audit_log restart identity;
truncate table public.app_events;
truncate table public.flow_insert_debug restart identity;

-- Preserve the canonical latest restoration record and at most three recent
-- per-window records per user/device. No current account state is removed.
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

select cron.schedule(
  'haw_bounded_history_retention',
  '23 4 * * *',
  $cron$select private.prune_bounded_history();$cron$
);

commit;
