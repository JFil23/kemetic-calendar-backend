begin;

drop trigger if exists user_app_restoration_prevent_stale_update
  on public.user_app_restoration_snapshots;
drop function if exists
  private.prevent_stale_restoration_snapshot_update();

commit;
