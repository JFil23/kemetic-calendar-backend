-- Phase 4: 90-day retention for flow_generation_cache (see docs/phase4-policy.md)
-- Run daily; delete rows older than 90 days. Guarded for environments without pg_cron.
do $$
begin
  -- Ensure pg_cron is available; ignore if not installable in this environment.
  begin
    create extension if not exists pg_cron with schema cron;
  exception
    when others then
      raise notice 'pg_cron not available (%); skipping schedule', SQLERRM;
  end;

  if to_regnamespace('cron') is null then
    raise notice 'cron schema missing; skipping flow_generation_cache_90d_purge schedule';
    return;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'schedule'
  ) then
    raise notice 'cron.schedule not available; skipping flow_generation_cache_90d_purge schedule';
    return;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'unschedule'
  ) and to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'flow_generation_cache_90d_purge') then
      perform cron.unschedule('flow_generation_cache_90d_purge');
    end if;
  end if;

  perform cron.schedule(
    'flow_generation_cache_90d_purge',
    '0 3 * * *',  -- daily at 03:00 UTC
    $cron$ delete from public.flow_generation_cache where created_at < now() - interval '90 days' $cron$);
end$$;
