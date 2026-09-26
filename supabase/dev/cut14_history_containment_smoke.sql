begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $$
begin
  if to_regprocedure(
    'public.active_maat_user_ids(timestamp with time zone)'
  ) is null then
    raise exception 'active Ma''at user selector is missing';
  end if;

  if to_regprocedure('private.prune_bounded_history()') is null then
    raise exception 'bounded-history retention function is missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.active_maat_user_ids(timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.active_maat_user_ids(timestamp with time zone)',
    'execute'
  ) then
    raise exception 'active-user selector is exposed to client roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.active_maat_user_ids(timestamp with time zone)',
    'execute'
  ) then
    raise exception 'service role cannot execute active-user selector';
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgname in (
      'trg_audit_app_events',
      'trg_audit_user_events',
      'trg_audit_flows',
      'trg_log_flow_inserts'
    )
      and not tgisinternal
  ) then
    raise exception 'an unbounded audit/debug trigger survived containment';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'trg_audit_profiles'
      and not tgisinternal
  ) then
    raise exception 'profile accountability trigger was removed';
  end if;

  if to_regclass('public.admin_audit_log') is null then
    raise exception 'admin audit log was removed';
  end if;

  if not exists (
    select 1
    from private.maat_delivery_ledger_backfill_state
    where singleton
      and backfill_completed_at is not null
      and backfill_cursor_delivery_key is null
      and backfill_batches_completed = 0
      and baseline_delivery_keys_added = 0
      and baseline_raw_events_added = 0
  ) then
    raise exception 'historical delivery-ledger baseline is not abandoned';
  end if;

  if exists (
    select 1 from private.maat_delivery_ledger_backfill_batch
    union all
    select 1 from private.maat_delivery_ledger_live_event_ids
  ) then
    raise exception 'delivery-ledger staging/handoff state is not empty';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'haw_bounded_history_retention'
      and schedule = '23 4 * * *'
      and active
  ) then
    raise exception 'bounded-history retention job is missing or inactive';
  end if;
end
$$;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  cron_job_name,
  delivery_status,
  created_at
) values (
  'cut14:containment-smoke',
  'reminder',
  'reminders',
  'cut14-containment-target',
  'cut14_containment_smoke',
  'picked',
  clock_timestamp()
);

do $$
begin
  if not exists (
    select 1
    from public.maat_delivery_ledger
    where delivery_key = 'cut14:containment-smoke'
      and raw_event_count = 1
      and picked_count = 1
  ) then
    raise exception 'live delivery-ledger synchronization is not intact';
  end if;

  if exists (
    select 1
    from private.maat_delivery_ledger_live_event_ids
    where delivery_key = 'cut14:containment-smoke'
  ) then
    raise exception 'completed backfill left live handoff residue';
  end if;
end
$$;

rollback;
