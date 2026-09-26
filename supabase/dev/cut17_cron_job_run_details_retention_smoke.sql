begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

create temp table cut17_cron_contract_before on commit drop as
select
  (
    select md5(coalesce(
      string_agg(md5(row_to_json(job)::text), '' order by job.jobid),
      ''
    ))
    from cron.job job
  ) as job_fingerprint,
  pg_get_viewdef('public.maat_delivery_cron_health'::regclass, true)
    as health_view_definition;

do $$
begin
  if to_regprocedure('private.prune_cron_job_run_details()') is null then
    raise exception 'cron run-detail retention function is missing';
  end if;

  if has_function_privilege(
    'anon',
    'private.prune_cron_job_run_details()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'private.prune_cron_job_run_details()',
    'execute'
  ) then
    raise exception 'cron run-detail retention is exposed to client roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'private.prune_cron_job_run_details()',
    'execute'
  ) then
    raise exception 'service role cannot execute cron run-detail retention';
  end if;

  if not exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname = 'prune_cron_job_run_details'
      and function.prosecdef
      and function.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'cron run-detail retention lost its hardened definition';
  end if;
end
$$;

delete from cron.job_run_details detail
using cron.job job
where detail.jobid = job.jobid
  and job.jobname in (
    'cron_reminder_push_1m',
    'decan_reflection_reconcile_daily',
    'maat_guidance_evaluate_hourly'
  );

insert into cron.job_run_details (
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
)
select
  job.jobid,
  fixture.runid,
  null,
  current_database(),
  current_user,
  'select 1',
  fixture.status,
  'cut17 retention smoke',
  fixture.start_time,
  fixture.end_time
from cron.job job
join (
  values
    (
      'cron_reminder_push_1m'::text,
      -170001::bigint,
      'succeeded'::text,
      now() - interval '15 days',
      now() - interval '15 days' + interval '1 second'
    ),
    (
      'cron_reminder_push_1m',
      -170002,
      'succeeded',
      now() - interval '13 days',
      now() - interval '13 days' + interval '1 second'
    ),
    (
      'cron_reminder_push_1m',
      -170003,
      'failed',
      now() - interval '1 minute',
      now() - interval '59 seconds'
    ),
    (
      'decan_reflection_reconcile_daily',
      -170004,
      'failed',
      now() - interval '15 days',
      now() - interval '15 days' + interval '1 second'
    ),
    (
      'decan_reflection_reconcile_daily',
      -170005,
      'failed',
      now() - interval '4 minutes',
      now() - interval '239 seconds'
    ),
    (
      'decan_reflection_reconcile_daily',
      -170006,
      'succeeded',
      now() - interval '30 seconds',
      now() - interval '29 seconds'
    )
) as fixture(jobname, runid, status, start_time, end_time)
  on fixture.jobname = job.jobname;

do $$
declare
  v_deleted bigint;
begin
  v_deleted := private.prune_cron_job_run_details();

  if v_deleted <> 2 then
    raise exception 'expected two expired cron rows, deleted %', v_deleted;
  end if;

  if exists (
    select 1
    from cron.job_run_details
    where runid in (-170001, -170004)
  ) then
    raise exception 'expired cron rows survived retention';
  end if;

  if (
    select count(*)
    from cron.job_run_details
    where runid in (-170002, -170003, -170005, -170006)
  ) <> 4 then
    raise exception 'recent/current cron rows were removed';
  end if;

  if private.prune_cron_job_run_details() <> 0 then
    raise exception 'cron run-detail retention is not idempotent';
  end if;
end
$$;

do $$
declare
  v_reminder public.maat_delivery_cron_health%rowtype;
  v_reflection public.maat_delivery_cron_health%rowtype;
begin
  select * into strict v_reminder
  from public.maat_delivery_cron_health
  where job_name = 'cron_reminder_push_1m';

  if v_reminder.last_status <> 'failed'
     or v_reminder.success_count <> 1
     or v_reminder.failure_count <> 1
     or v_reminder.health_status <> 'late' then
    raise exception 'reminder cron-health projection changed: %',
      row_to_json(v_reminder);
  end if;

  select * into strict v_reflection
  from public.maat_delivery_cron_health
  where job_name = 'decan_reflection_reconcile_daily';

  if v_reflection.last_status <> 'succeeded'
     or v_reflection.success_count <> 1
     or v_reflection.failure_count <> 1
     or v_reflection.health_status <> 'healthy' then
    raise exception 'reflection cron-health projection changed: %',
      row_to_json(v_reflection);
  end if;
end
$$;

insert into cron.job_run_details (
  jobid,
  runid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
)
select
  job.jobid,
  -170007,
  current_database(),
  current_user,
  'select 1',
  'succeeded',
  'cut17 bounded-history integration smoke',
  now() - interval '15 days',
  now() - interval '15 days' + interval '1 second'
from cron.job job
where job.jobname = 'maat_guidance_evaluate_hourly';

do $$
declare
  v_result jsonb;
begin
  v_result := private.prune_bounded_history();

  if v_result ->> 'cron_job_run_details' <> '1' then
    raise exception 'daily bounded-history cleanup did not report cron delete: %',
      v_result;
  end if;

  if exists (
    select 1 from cron.job_run_details where runid = -170007
  ) then
    raise exception 'daily bounded-history cleanup did not prune cron history';
  end if;
end
$$;

do $$
declare
  v_job_fingerprint text;
  v_health_view_definition text;
begin
  select md5(coalesce(
    string_agg(md5(row_to_json(job)::text), '' order by job.jobid),
    ''
  )) into v_job_fingerprint
  from cron.job job;

  select pg_get_viewdef(
    'public.maat_delivery_cron_health'::regclass,
    true
  ) into v_health_view_definition;

  if not exists (
    select 1
    from cut17_cron_contract_before before
    where before.job_fingerprint = v_job_fingerprint
      and before.health_view_definition = v_health_view_definition
  ) then
    raise exception 'cron definitions or health-view contract changed';
  end if;
end
$$;

rollback;
