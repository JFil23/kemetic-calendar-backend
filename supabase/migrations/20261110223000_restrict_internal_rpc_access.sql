begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Internal helpers bypass RLS and are reached by service callers or existing
-- checked SECURITY DEFINER entrypoints. Preserve their bodies and ownership.
do $$
declare signature text; target regprocedure;
begin
  foreach signature in array array[
    'public._is_personalization_enabled(uuid)',
    'public.clear_event_share_import_tombstone(uuid,uuid)',
    'public.prune_stale_reminder_occurrences()',
    'public.purge_old_event_deletion_trash()',
    'public.reconcile_event_filing_backbone(integer)',
    'public.repair_active_reminder_filing_backbone()',
    'public.sync_event_share_calendar_copy_from_row(event_shares)',
    'public.claim_due_scheduled_notifications(timestamp with time zone,integer,integer)',
    'public.compute_flow_outcome(bigint)',
    'public.compute_user_preferences_impl(uuid,integer)',
    'public.dm_user_pref_candidates(integer)',
    'public.event_share_source_flow_payload(uuid)',
    'public.flow_outcome_candidates(integer)',
    'public.fn_ai_quota_check_and_inc(uuid,date,integer)',
    'public.resolve_maat_obligation(uuid,text,text,jsonb,timestamp with time zone,text,text)',
    'public.resolve_maat_obligations_for_field(uuid,text,text,text,jsonb,timestamp with time zone,date,text,text)'
  ] loop
    target := to_regprocedure(signature);
    if target is null or not exists (select 1 from pg_proc
      where oid=target and prosecdef and pg_get_userbyid(proowner)='postgres') then
      raise exception 'Unrecognized internal function authority: %', signature;
    end if;
    execute format('revoke all privileges on function %s from public, anon, authenticated', target);
    execute format('grant execute on function %s to service_role', target);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
