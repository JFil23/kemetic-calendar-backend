-- Server-side delivery schedules for guidance openings and due notifications.
--
-- Requires Supabase Cron (pg_cron), pg_net, and Vault secrets:
--   project_url       = https://<project-ref>.supabase.co
--   maat_cron_secret  = value also configured as MAAT_CRON_SECRET
--
-- Optional:
--   reminder_cron_secret = value configured as REMINDER_CRON_SECRET.
-- If absent, reminder delivery uses maat_cron_secret so one scheduler secret can
-- operate all Ma'at-adjacent delivery jobs.

do $$
begin
  begin
    create extension if not exists pg_cron with schema cron;
  exception when others then
    raise notice 'pg_cron not available (%); skipping delivery cron schedules', SQLERRM;
  end;

  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net not available (%); skipping delivery cron schedules', SQLERRM;
  end;

  if to_regnamespace('cron') is null then
    raise notice 'cron schema missing; skipping delivery cron schedules';
    return;
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cron'
       and p.proname = 'schedule'
  ) then
    raise notice 'cron.schedule not available; skipping delivery cron schedules';
    return;
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net'
       and p.proname = 'http_post'
  ) then
    raise notice 'net.http_post not available; skipping delivery cron schedules';
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'vault.decrypted_secrets missing; skipping delivery cron schedules';
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
      select 1 from cron.job
      where jobname = 'maat_guidance_decan_opening_6h'
    ) then
      perform cron.unschedule('maat_guidance_decan_opening_6h');
    end if;

    if exists (
      select 1 from cron.job
      where jobname = 'maat_guidance_decan_opening_hourly'
    ) then
      perform cron.unschedule('maat_guidance_decan_opening_hourly');
    end if;

    if exists (
      select 1 from cron.job
      where jobname = 'cron_reminder_push_1m'
    ) then
      perform cron.unschedule('cron_reminder_push_1m');
    end if;

    if exists (
      select 1 from cron.job
      where jobname = 'cron_reminder_push_every_minute'
    ) then
      perform cron.unschedule('cron_reminder_push_every_minute');
    end if;

    if exists (
      select 1 from cron.job
      where jobname = 'maat_guidance_evaluate_hourly'
    ) then
      perform cron.unschedule('maat_guidance_evaluate_hourly');
    end if;
  end if;

  perform cron.schedule(
    'maat_guidance_decan_opening_hourly',
    '17 * * * *',
    $cron$
    with secrets as (
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
        (select decrypted_secret from vault.decrypted_secrets where name = 'maat_cron_secret') as cron_secret
    )
    select
      case
        when project_url is not null and cron_secret is not null then
          net.http_post(
            url := project_url || '/functions/v1/cron_maat_decan_opening',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', cron_secret
            ),
            body := jsonb_build_object(
              'source', 'pg_cron',
              'scheduled_at', now(),
              'limit', 20000,
              'batch_size', 1000,
              'max_runtime_ms', 110000
            )
          )
        else null
      end as request_id
    from secrets;
    $cron$
  );

  perform cron.schedule(
    'maat_guidance_evaluate_hourly',
    '5 * * * *',
    $cron$
    with secrets as (
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
        (select decrypted_secret from vault.decrypted_secrets where name = 'maat_cron_secret') as cron_secret
    )
    select
      case
        when project_url is not null and cron_secret is not null then
          net.http_post(
            url := project_url || '/functions/v1/cron_evaluate_maat_guidance',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', cron_secret
            ),
            body := jsonb_build_object(
              'source', 'pg_cron',
              'scheduled_at', now(),
              'local_hour', 0,
              'limit', 20000,
              'batch_size', 1000,
              'max_runtime_ms', 110000
            )
          )
        else null
      end as request_id
    from secrets;
    $cron$
  );

  perform cron.schedule(
    'cron_reminder_push_1m',
    '* * * * *',
    $cron$
    with secrets as (
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
        coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret'),
          (select decrypted_secret from vault.decrypted_secrets where name = 'maat_cron_secret'),
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ) as cron_secret
    )
    select
      case
        when project_url is not null and cron_secret is not null then
          net.http_post(
            url := project_url || '/functions/v1/cron_reminder_push',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', cron_secret
            ),
            body := jsonb_build_object(
              'source', 'pg_cron',
              'scheduled_at', now()
            )
          )
        else null
      end as request_id
    from secrets;
    $cron$
  );
end
$$;
