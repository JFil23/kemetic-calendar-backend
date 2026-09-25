begin;

-- Cut 14 rollback removes only the new ledger infrastructure. The append-only
-- raw timing table and all pre-existing delivery readers remain untouched.
drop trigger if exists maat_delivery_ledger_sync
  on public.maat_delivery_timing_events;

drop function if exists private.sync_maat_delivery_ledger_from_raw();
drop function if exists private.backfill_maat_delivery_ledger();

drop table if exists private.maat_delivery_ledger_backfill_batch;
drop table if exists private.maat_delivery_ledger_live_event_ids;
drop table if exists private.maat_delivery_ledger_backfill_state;
drop table if exists public.maat_delivery_ledger;

commit;
