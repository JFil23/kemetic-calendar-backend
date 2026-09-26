begin;

set local statement_timeout = '2min';

do $$
declare
  v_user_a uuid := '00000000-0000-4000-8000-000000001901';
  v_user_b uuid := '00000000-0000-4000-8000-000000001902';
  v_due_a timestamptz := date_trunc('minute', now()) + interval '2 days';
  v_due_b timestamptz := date_trunc('minute', now()) + interval '3 days';
  v_shared_job text;
  v_claimed integer;
  v_before_generations bigint;
  v_claim record;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'decan_reflection_schedule'
      and column_name = 'next_attempt_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'next_attempt_at contract is missing';
  end if;

  if private.decan_reflection_due_job_name('2026-10-06 01:00:00+00') <>
    'decan_reflection_due_20261006T0100Z' then
    raise exception 'deterministic bucket name is wrong';
  end if;

  if ('2026-10-05'::date + time '18:00') at time zone 'America/Los_Angeles'
      <> '2026-10-06 01:00:00+00'::timestamptz
    or ('2026-10-05'::date + time '18:00') at time zone 'America/New_York'
      <> '2026-10-05 22:00:00+00'::timestamptz
    or ('2026-10-05'::date + time '18:00') at time zone 'America/Chicago'
      <> '2026-10-05 23:00:00+00'::timestamptz then
    raise exception '18:00 timezone conversion is wrong';
  end if;

  if ('2026-03-08'::date + time '18:00') at time zone 'America/Los_Angeles'
      <> '2026-03-09 01:00:00+00'::timestamptz
    or ('2026-11-01'::date + time '18:00') at time zone 'America/Los_Angeles'
      <> '2026-11-02 02:00:00+00'::timestamptz then
    raise exception '18:00 DST conversion is wrong';
  end if;

  insert into auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values
    (v_user_a, 'authenticated', 'authenticated',
      'reflection-one-shot-a@example.test', 'not-used', now(), now(), now()),
    (v_user_b, 'authenticated', 'authenticated',
      'reflection-one-shot-b@example.test', 'not-used', now(), now(), now());

  insert into public.decan_reflection_schedule (
    user_id, decan_start, decan_end, send_at, next_attempt_at, status
  ) values
    (v_user_a, current_date + 1, current_date + 10, v_due_a, v_due_a, 'pending'),
    (v_user_b, current_date + 1, current_date + 10, v_due_a, v_due_a, 'pending'),
    (v_user_a, current_date + 11, current_date + 20, v_due_b, v_due_b, 'pending');

  v_shared_job := private.decan_reflection_due_job_name(v_due_a);
  if (select count(*) from cron.job where jobname = v_shared_job) <> 1 then
    raise exception 'shared due minute did not create exactly one bucket';
  end if;
  if (
    select count(*) from cron.job where jobname like 'decan_reflection_due_%'
  ) < 2 then
    raise exception 'different due minutes did not create separate buckets';
  end if;

  perform private.ensure_decan_reflection_due_bucket(v_due_a);
  if (select count(*) from cron.job where jobname = v_shared_job) <> 1 then
    raise exception 'duplicate registration was not idempotent';
  end if;

  update public.decan_reflection_schedule
  set send_at = v_due_b,
      next_attempt_at = v_due_b
  where user_id = v_user_b and decan_start = current_date + 1;
  v_claimed := 0;
  for v_claim in
    select *
    from public.claim_due_decan_reflection_schedule(v_due_a, 25, 900)
  loop
    if v_claim.user_id = v_user_b then
      raise exception 'stale old bucket could claim a rescheduled row early';
    end if;
    if v_claim.user_id = v_user_a
      and v_claim.decan_start = current_date + 1 then
      v_claimed := v_claimed + 1;
    end if;
  end loop;
  if v_claimed <> 1 then
    raise exception 'exact-due claim expected 1, got %', v_claimed;
  end if;
  if exists (
    select 1
    from public.claim_due_decan_reflection_schedule(v_due_a, 25, 900)
    where user_id = v_user_a and decan_start = current_date + 1
  ) then
    raise exception 'duplicate wake-up duplicated the active lease claim';
  end if;

  update public.decan_reflection_schedule
  set claimed_at = now() - interval '16 minutes'
  where user_id = v_user_a and decan_start = current_date + 1;
  perform public.reconcile_decan_reflection_scheduler();
  if not exists (
    select 1 from public.decan_reflection_schedule
    where user_id = v_user_a
      and decan_start = current_date + 1
      and status = 'pending'
      and claim_token is null
      and next_attempt_at > now()
  ) then
    raise exception 'expired claim was not recovered to a future one-shot';
  end if;

  select count(*) into v_before_generations from public.reflection_generations;
  perform public.reconcile_decan_reflection_scheduler();
  if (select count(*) from public.reflection_generations) <> v_before_generations then
    raise exception 'daily reconciliation generated a reflection';
  end if;

  if exists (
    select 1 from cron.job where jobname = 'decan_reflection_push_5m'
  ) then
    raise exception 'five-minute reflection poller remains installed';
  end if;
  if (
    select count(*) from cron.job
    where jobname = 'decan_reflection_reconcile_daily'
      and schedule = '7 8 * * *'
      and active
  ) <> 1 then
    raise exception 'exactly one daily reconciler is required';
  end if;
end
$$;

rollback;
