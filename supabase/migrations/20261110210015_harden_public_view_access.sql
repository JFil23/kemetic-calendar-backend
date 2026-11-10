begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Preserve every view definition and service caller. Only execution context
-- and direct client privileges change; canonical Inbox snapshots are separate.
do $$
declare name text;
begin
  foreach name in array array[
    'flow_generation_daily_analytics', 'flows_color_debug',
    'inbox_share_items', 'maat_ledger_restoration_health', 'profile_stats'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=name and c.relkind='v'
        and pg_get_userbyid(c.relowner)='postgres'
    ) then
      raise exception 'Unrecognized view authority: public.%', name;
    end if;
    execute format('alter view public.%I set (security_invoker = true)', name);
  end loop;
end $$;

-- No app caller uses these internal/legacy views. The active Inbox owner is
-- inbox_share_items_filtered and reads immutable share snapshots under RLS.
revoke all privileges on table
  public.flow_generation_daily_analytics,
  public.flows_color_debug,
  public.inbox_share_items,
  public.maat_ledger_restoration_health
from public, anon, authenticated;
grant select on table
  public.flow_generation_daily_analytics,
  public.flows_color_debug,
  public.inbox_share_items,
  public.maat_ledger_restoration_health
to service_role;

-- Public profile fields and authored aggregate counts retain their existing
-- read contract. Mutations continue through the profiles owner and its RLS.
revoke insert, update, delete, truncate, references, trigger
on table public.profile_stats from public, anon, authenticated;
grant select on table public.profile_stats to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
