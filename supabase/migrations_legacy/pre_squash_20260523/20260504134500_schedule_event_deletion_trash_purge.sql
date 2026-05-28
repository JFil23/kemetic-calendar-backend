do $$
begin
  begin
    create extension if not exists pg_cron with schema cron;
  exception
    when others then
      raise notice 'pg_cron not available (%); skipping event_deletion_trash purge schedule', SQLERRM;
  end;

  if to_regnamespace('cron') is null then
    raise notice 'cron schema missing; skipping event_deletion_trash purge schedule';
    return;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'schedule'
  ) then
    raise notice 'cron.schedule not available; skipping event_deletion_trash purge schedule';
    return;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'unschedule'
  ) and to_regclass('cron.job') is not null then
    if exists (
      select 1
      from cron.job
      where jobname = 'event_deletion_trash_10d_purge'
    ) then
      perform cron.unschedule('event_deletion_trash_10d_purge');
    end if;
  end if;

  perform public.purge_old_event_deletion_trash();

  perform cron.schedule(
    'event_deletion_trash_10d_purge',
    '20 3 * * *',
    $cron$ select public.purge_old_event_deletion_trash(); $cron$
  );
end$$;
