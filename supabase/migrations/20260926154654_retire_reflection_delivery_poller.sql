begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'decan_reflection_push_5m'
  ) then
    perform cron.unschedule('decan_reflection_push_5m');
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'decan_reflection_reconcile_daily'
      and active
      and schedule = '7 8 * * *'
  ) then
    raise exception 'Daily reflection scheduler reconciliation is not active';
  end if;
end
$$;

comment on function public.claim_due_decan_reflection_schedule(
  timestamp with time zone, integer, integer
) is
'Atomically claims due one-shot decan reflection schedules using next_attempt_at, FOR UPDATE SKIP LOCKED, and an expiring lease token.';

commit;
