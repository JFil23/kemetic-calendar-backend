begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

-- Durable restoration freshness is owned by the database. A delayed client
-- write may be valid for a previously absent window row, but it must never
-- replace a row whose client-authored freshness timestamp is newer.
create or replace function private.prevent_stale_restoration_snapshot_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_stale_restoration_snapshot_update()
  from public, anon, authenticated;

drop trigger if exists user_app_restoration_prevent_stale_update
  on public.user_app_restoration_snapshots;
create trigger user_app_restoration_prevent_stale_update
before update on public.user_app_restoration_snapshots
for each row
execute function private.prevent_stale_restoration_snapshot_update();

commit;
