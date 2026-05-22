-- Server-side backup schedule for Ma'at decan opening guidance.
--
-- Requires Supabase Cron (pg_cron), pg_net, and Vault secrets:
--   project_url       = https://<project-ref>.supabase.co
--   maat_cron_secret  = value also configured as MAAT_CRON_SECRET for the Edge Function
--
-- The mobile client scheduler remains a fallback; this job makes opening
-- generation independent of app launches when the hosted platform supports it.

do $$
begin
  begin
    create extension if not exists pg_cron with schema cron;
  exception when others then
    raise notice 'pg_cron not available (%); skipping maat_guidance_decan_opening_6h schedule', SQLERRM;
  end;

  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net not available (%); skipping maat_guidance_decan_opening_6h schedule', SQLERRM;
  end;

  if to_regnamespace('cron') is null then
    raise notice 'cron schema missing; skipping maat_guidance_decan_opening_6h schedule';
    return;
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cron'
       and p.proname = 'schedule'
  ) then
    raise notice 'cron.schedule not available; skipping maat_guidance_decan_opening_6h schedule';
    return;
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net'
       and p.proname = 'http_post'
  ) then
    raise notice 'net.http_post not available; skipping maat_guidance_decan_opening_6h schedule';
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'vault.decrypted_secrets missing; skipping maat_guidance_decan_opening_6h schedule';
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
  end if;

  perform cron.schedule(
    'maat_guidance_decan_opening_6h',
    '17 */6 * * *',
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
