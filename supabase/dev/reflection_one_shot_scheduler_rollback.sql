-- Emergency rollback only. Do not apply during normal operation.
-- Schedule rows are preserved; this temporarily restores polling and 20:00
-- local scheduling authority while disabling automatic one-shot registration.
begin;

drop trigger if exists decan_reflection_schedule_register_wake
  on public.decan_reflection_schedule;
drop trigger if exists decan_reflection_schedule_prepare_wake
  on public.decan_reflection_schedule;

do $$
declare
  job record;
begin
  for job in
    select jobname from cron.job where jobname like 'decan_reflection_due_%'
  loop
    perform cron.unschedule(job.jobname);
  end loop;
  if exists (
    select 1 from cron.job where jobname = 'decan_reflection_reconcile_daily'
  ) then
    perform cron.unschedule('decan_reflection_reconcile_daily');
  end if;
end
$$;

-- Re-enable the prior migration's decan_reflection_push_5m command before
-- deploying the prior worker bundle. Restore the 20:00 helper in source and
-- deploy schedule_decan_reflection only if product rollback is required.

commit;
