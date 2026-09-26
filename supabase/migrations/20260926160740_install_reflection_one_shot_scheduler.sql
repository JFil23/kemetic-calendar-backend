begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

alter table public.decan_reflection_schedule
  add column if not exists next_attempt_at timestamp with time zone;

comment on column public.decan_reflection_schedule.send_at is
'Product due time: 18:00 in the user IANA timezone on the final local calendar day of the decan.';
comment on column public.decan_reflection_schedule.next_attempt_at is
'Operational one-shot wake or retry time. Fresh pending rows use send_at; retries do not mutate send_at.';

drop index if exists public.idx_decan_reflection_schedule_due_claim;
create index idx_decan_reflection_schedule_due_claim
on public.decan_reflection_schedule (next_attempt_at, claimed_at)
where status in ('pending', 'claimed');

create or replace function public.claim_due_decan_reflection_schedule(
  p_now timestamp with time zone default now(),
  p_limit integer default 25,
  p_lease_seconds integer default 900
)
returns table (
  id uuid,
  user_id uuid,
  decan_start date,
  decan_end date,
  decan_name text,
  decan_theme text,
  decan_context_key text,
  attempt_count integer,
  claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 250);
  v_lease interval := make_interval(
    secs => greatest(coalesce(p_lease_seconds, 900), 30)
  );
  v_claim_token text := gen_random_uuid()::text;
begin
  return query
  with candidate_ids as (
    select schedule.id
    from public.decan_reflection_schedule schedule
    where schedule.next_attempt_at <= p_now
      and (
        schedule.status = 'pending'
        or (
          schedule.status = 'claimed'
          and (
            schedule.claimed_at is null
            or schedule.claimed_at < (p_now - v_lease)
          )
        )
      )
    order by schedule.next_attempt_at, schedule.id
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.decan_reflection_schedule schedule
    set status = 'claimed',
        claimed_at = p_now,
        claim_token = v_claim_token
    from candidate_ids candidate
    where schedule.id = candidate.id
    returning
      schedule.id,
      schedule.user_id,
      schedule.decan_start,
      schedule.decan_end,
      schedule.decan_name,
      schedule.decan_theme,
      schedule.decan_context_key,
      schedule.attempt_count
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.decan_start,
    claimed.decan_end,
    claimed.decan_name,
    claimed.decan_theme,
    claimed.decan_context_key,
    claimed.attempt_count,
    v_claim_token
  from claimed;
end;
$$;

revoke all on function public.claim_due_decan_reflection_schedule(
  timestamp with time zone, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_due_decan_reflection_schedule(
  timestamp with time zone, integer, integer
) to service_role;

create or replace function private.decan_reflection_due_job_name(
  p_bucket timestamp with time zone
)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select 'decan_reflection_due_' ||
    to_char(p_bucket at time zone 'UTC', 'YYYYMMDD"T"HH24MI"Z"')
$$;

create or replace function private.invoke_decan_reflection_due_bucket(
  p_bucket timestamp with time zone,
  p_job_name text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_project_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  if p_job_name is distinct from private.decan_reflection_due_job_name(p_bucket) then
    raise exception 'Invalid decan reflection bucket identity';
  end if;

  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'decan_reflection_cron_secret';

  if v_project_url is null or v_cron_secret is null then
    raise exception 'Missing reflection scheduler Vault secrets';
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/cron_decan_reflection_push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    ),
    body := jsonb_build_object(
      'source', 'decan_reflection_one_shot',
      'scheduled_bucket', p_bucket
    )
  ) into v_request_id;

  if v_request_id is null then
    raise exception 'Reflection worker request was not enqueued';
  end if;

  perform cron.unschedule(p_job_name);
  return v_request_id;
end;
$$;

create or replace function private.ensure_decan_reflection_due_bucket(
  p_due timestamp with time zone
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_bucket timestamp with time zone;
  v_job_name text;
  v_schedule text;
  v_command text;
begin
  if p_due is null then
    raise exception 'Reflection due bucket requires a timestamp';
  end if;

  v_bucket := date_trunc('minute', p_due);
  if v_bucket <= clock_timestamp() then
    v_bucket := date_trunc('minute', clock_timestamp()) + interval '1 minute';
  end if;
  if v_bucket > clock_timestamp() + interval '366 days' then
    raise exception 'Reflection due bucket is more than 366 days away';
  end if;

  v_job_name := private.decan_reflection_due_job_name(v_bucket);
  v_schedule := format(
    '%s %s %s %s *',
    extract(minute from v_bucket at time zone 'UTC')::integer,
    extract(hour from v_bucket at time zone 'UTC')::integer,
    extract(day from v_bucket at time zone 'UTC')::integer,
    extract(month from v_bucket at time zone 'UTC')::integer
  );
  v_command := format(
    'select private.invoke_decan_reflection_due_bucket(%L::timestamptz, %L::text);',
    v_bucket,
    v_job_name
  );

  if exists (
    select 1 from cron.job job
    where job.jobname = v_job_name
      and job.schedule = v_schedule
      and job.command = v_command
      and job.active
  ) then
    return v_job_name;
  end if;

  perform cron.schedule(v_job_name, v_schedule, v_command);
  return v_job_name;
end;
$$;

revoke all on function private.decan_reflection_due_job_name(timestamp with time zone)
  from public, anon, authenticated;
revoke all on function private.invoke_decan_reflection_due_bucket(
  timestamp with time zone, text
) from public, anon, authenticated;
revoke all on function private.ensure_decan_reflection_due_bucket(
  timestamp with time zone
) from public, anon, authenticated;

create or replace function private.prepare_decan_reflection_schedule_wake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'pending' then
    if tg_op = 'INSERT' and new.next_attempt_at is null then
      new.next_attempt_at := new.send_at;
    elsif tg_op = 'UPDATE' and new.send_at is distinct from old.send_at then
      new.next_attempt_at := new.send_at;
    elsif new.next_attempt_at is null then
      new.next_attempt_at := new.send_at;
    end if;
  elsif new.status not in ('claimed') then
    new.next_attempt_at := null;
  end if;
  return new;
end;
$$;

create or replace function private.register_decan_reflection_schedule_wake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'pending' and new.next_attempt_at is not null then
    perform private.ensure_decan_reflection_due_bucket(new.next_attempt_at);
  end if;
  return new;
end;
$$;

revoke all on function private.prepare_decan_reflection_schedule_wake()
  from public, anon, authenticated;
revoke all on function private.register_decan_reflection_schedule_wake()
  from public, anon, authenticated;

drop trigger if exists decan_reflection_schedule_prepare_wake
  on public.decan_reflection_schedule;
create trigger decan_reflection_schedule_prepare_wake
before insert or update of status, send_at, next_attempt_at
on public.decan_reflection_schedule
for each row execute function private.prepare_decan_reflection_schedule_wake();

drop trigger if exists decan_reflection_schedule_register_wake
  on public.decan_reflection_schedule;
create trigger decan_reflection_schedule_register_wake
after insert or update of status, send_at, next_attempt_at
on public.decan_reflection_schedule
for each row execute function private.register_decan_reflection_schedule_wake();

-- Migrate only canonical future pending schedules from 20:00 to 18:00 local.
update public.decan_reflection_schedule schedule
set send_at = (schedule.decan_end + time '18:00')
      at time zone coalesce(nullif(profile.timezone, ''), 'UTC'),
    next_attempt_at = (schedule.decan_end + time '18:00')
      at time zone coalesce(nullif(profile.timezone, ''), 'UTC')
from public.profiles profile
where schedule.user_id = profile.id
  and schedule.status = 'pending';

create or replace function public.reconcile_decan_reflection_scheduler()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamp with time zone := clock_timestamp();
  v_recovered integer := 0;
  v_initialized integer := 0;
  v_overdue integer := 0;
  v_buckets integer := 0;
  v_orphans integer := 0;
  v_due timestamp with time zone;
  v_job record;
  v_missing integer;
begin
  with recovered as (
    update public.decan_reflection_schedule schedule
    set status = 'pending',
        claimed_at = null,
        claim_token = null,
        next_attempt_at = date_trunc('minute', v_now) + interval '1 minute',
        last_error = coalesce(schedule.last_error, 'expired_claim_recovered')
    where schedule.status = 'claimed'
      and (
        schedule.claimed_at is null
        or schedule.claimed_at < v_now - interval '15 minutes'
      )
    returning 1
  ) select count(*) into v_recovered from recovered;

  with initialized as (
    update public.decan_reflection_schedule schedule
    set next_attempt_at = schedule.send_at
    where schedule.status = 'pending'
      and schedule.next_attempt_at is null
    returning 1
  ) select count(*) into v_initialized from initialized;

  with overdue as (
    update public.decan_reflection_schedule schedule
    set next_attempt_at = date_trunc('minute', v_now) + interval '1 minute'
    where schedule.status = 'pending'
      and schedule.next_attempt_at < date_trunc('minute', v_now)
    returning 1
  ) select count(*) into v_overdue from overdue;

  for v_due in
    select distinct schedule.next_attempt_at
    from public.decan_reflection_schedule schedule
    where schedule.status = 'pending'
      and schedule.next_attempt_at is not null
  loop
    perform private.ensure_decan_reflection_due_bucket(v_due);
    v_buckets := v_buckets + 1;
  end loop;

  for v_job in
    select job.jobname
    from cron.job job
    where job.jobname like 'decan_reflection_due_%'
      and not exists (
        select 1
        from public.decan_reflection_schedule schedule
        where schedule.status = 'pending'
          and private.decan_reflection_due_job_name(
            date_trunc('minute', schedule.next_attempt_at)
          ) = job.jobname
      )
  loop
    perform cron.unschedule(v_job.jobname);
    v_orphans := v_orphans + 1;
  end loop;

  select count(*) into v_missing
  from (
    select distinct private.decan_reflection_due_job_name(
      date_trunc('minute', schedule.next_attempt_at)
    ) as jobname
    from public.decan_reflection_schedule schedule
    where schedule.status = 'pending'
      and schedule.next_attempt_at is not null
  ) desired
  where not exists (
    select 1 from cron.job job
    where job.jobname = desired.jobname and job.active
  );

  if v_missing <> 0 then
    raise exception 'Reflection scheduler still has % missing buckets', v_missing;
  end if;

  return jsonb_build_object(
    'recovered_claims', v_recovered,
    'initialized_rows', v_initialized,
    'overdue_rows', v_overdue,
    'pending_buckets', v_buckets,
    'orphan_jobs_removed', v_orphans,
    'missing_buckets', v_missing
  );
end;
$$;

revoke all on function public.reconcile_decan_reflection_scheduler()
  from public, anon, authenticated;
grant execute on function public.reconcile_decan_reflection_scheduler()
  to service_role;

-- The daily job only seeds/repairs scheduler continuity. It does not deliver.
select cron.schedule(
  'decan_reflection_reconcile_daily',
  '7 8 * * *',
  $cron$
  with secrets as (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'decan_reflection_cron_secret') as cron_secret
  )
  select net.http_post(
    url := project_url || '/functions/v1/cron_decan_reflection_reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object(
      'source', 'decan_reflection_reconcile_daily',
      'scheduled_at', now()
    )
  )
  from secrets
  where project_url is not null and cron_secret is not null;
  $cron$
);

do $$
begin
  if to_regclass('cron.job') is not null
     and to_regclass('cron.job_run_details') is not null then
    execute $view$
      create or replace view public.maat_delivery_cron_health
      with (security_invoker = true) as
      select
        job.jobname::text as job_name,
        job.schedule::text as schedule,
        job.active,
        max(run.start_time) as last_started_at,
        max(run.end_time) as last_finished_at,
        (array_agg(run.status order by run.start_time desc)
          filter (where run.status is not null))[1]::text as last_status,
        max(run.end_time) filter (where run.status = 'succeeded')
          as last_success_at,
        count(*) filter (where run.status = 'succeeded')::integer
          as success_count,
        count(*) filter (
          where run.status is not null and run.status <> 'succeeded'
        )::integer as failure_count,
        case
          when max(run.end_time) filter (where run.status = 'succeeded') is null
            then null
          else floor(extract(epoch from (
            now() - max(run.end_time) filter (where run.status = 'succeeded')
          )))::integer
        end as seconds_since_success,
        case
          when not job.active then 'paused'
          when max(run.end_time) filter (where run.status = 'succeeded') is null
            then 'no_success_yet'
          when job.jobname = 'cron_reminder_push_1m'
            and now() - max(run.end_time) filter (where run.status = 'succeeded')
              > interval '3 minutes'
            then 'late'
          when job.jobname = 'decan_reflection_reconcile_daily'
            and now() - max(run.end_time) filter (where run.status = 'succeeded')
              > interval '26 hours'
            then 'late'
          when job.jobname in (
            'maat_guidance_evaluate_hourly',
            'maat_guidance_decan_opening_hourly'
          )
            and now() - max(run.end_time) filter (where run.status = 'succeeded')
              > interval '2 hours'
            then 'late'
          else 'healthy'
        end as health_status
      from cron.job job
      left join cron.job_run_details run on run.jobid = job.jobid
      where job.jobname in (
        'cron_reminder_push_1m',
        'decan_reflection_reconcile_daily',
        'maat_guidance_evaluate_hourly',
        'maat_guidance_decan_opening_hourly'
      )
      group by job.jobname, job.schedule, job.active
    $view$;
  end if;
end
$$;

commit;
