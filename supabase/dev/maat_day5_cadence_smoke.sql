-- Local-only smoke test for day-5 Ma'at/Isfet cadence proof.
-- Run after migrations against a disposable local DB:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dev/maat_day5_cadence_smoke.sql
-- The transaction rolls back after assertions.

begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000d500',
  'authenticated',
  'authenticated',
  'maat-day5-smoke@example.test',
  'not-used',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000d510',
  'authenticated',
  'authenticated',
  'maat-day5-isfet-smoke@example.test',
  'not-used',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

insert into public.maat_guidance_deliveries (
  id,
  user_id,
  kind,
  decan_period_key,
  status,
  priority,
  teaser_text,
  body_text,
  payload,
  cta_type,
  cta_ref,
  trigger_reason,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000d501',
  '00000000-0000-4000-8000-00000000d500',
  'strength_nudge',
  '2026-05-16:2026-05-25:day5-smoke',
  'pending',
  30,
  'Your rhythm is holding. Protect it.',
  'The pattern is holding. Protection: protect the provision rhythm before adding another demand.',
  jsonb_build_object(
    'cadence_type', 'decan_day_5',
    'cadence_mode', 'maat',
    'delivery_channel', 'in_app_card',
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object(
        'kind', 'strength_nudge',
        'speechAct', 'fortify'
      ),
      'validation', jsonb_build_object('ok', true),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 4.8,
        'deliveryRecommendation', 'in_app_card',
        'repairMode', 'none',
        'failureReasons', '[]'::jsonb
      )
    )
  ),
  'none',
  null,
  'decan_day_5_maat',
  now(),
  now()
);

insert into public.maat_guidance_deliveries (
  id,
  user_id,
  kind,
  decan_period_key,
  status,
  priority,
  teaser_text,
  body_text,
  payload,
  cta_type,
  cta_ref,
  trigger_reason,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000d511',
  '00000000-0000-4000-8000-00000000d510',
  'drift_nudge',
  '2026-05-16:2026-05-25:day5-isfet-smoke',
  'pending',
  20,
  'Tend to provision: restore one provision check.',
  'Tend to provision by restoring one provision check and recording the return plainly. Keep it small enough to finish today. Open the suggested flow if you need a container for the return.',
  jsonb_build_object(
    'cadence_type', 'decan_day_5',
    'cadence_mode', 'isfet',
    'delivery_channel', 'in_app_card',
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object(
        'kind', 'drift_nudge',
        'speechAct', 'correct'
      ),
      'validation', jsonb_build_object('ok', true),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 4.6,
        'deliveryRecommendation', 'in_app_card',
        'repairMode', 'none',
        'failureReasons', '[]'::jsonb
      )
    )
  ),
  'flow_template',
  'the-offering-table',
  'decan_day_5_isfet',
  now(),
  now()
);

do $$
begin
  begin
    insert into public.maat_guidance_deliveries (
      id,
      user_id,
      kind,
      decan_period_key,
      status,
      priority,
      teaser_text,
      body_text,
      payload,
      cta_type,
      cta_ref,
      trigger_reason,
      created_at,
      updated_at
    ) values (
      '00000000-0000-4000-8000-00000000d502',
      '00000000-0000-4000-8000-00000000d500',
      'drift_nudge',
      '2026-05-16:2026-05-25:day5-smoke',
      'pending',
      20,
      'Tend to provision: restore one provision check.',
      'Tend to provision by restoring one provision check.',
      jsonb_build_object(
        'cadence_type', 'decan_day_5',
        'cadence_mode', 'isfet'
      ),
      'flow_template',
      'the-offering-table',
      'decan_day_5_isfet',
      now(),
      now()
    );
    raise exception 'Expected duplicate day-5 cadence insert to fail';
  exception
    when unique_violation then
      null;
  end;
end
$$;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  user_id,
  scheduled_for,
  cron_picked_at,
  function_started_at,
  delivered_at,
  cron_job_name,
  delivery_attempt,
  delivery_status,
  metadata,
  created_at
) values (
  'maat_guidance:00000000-0000-4000-8000-00000000d501',
  'strength_nudge',
  'maat_guidance_deliveries',
  '00000000-0000-4000-8000-00000000d501',
  '00000000-0000-4000-8000-00000000d500',
  now() - interval '10 seconds',
  now() - interval '9 seconds',
  now() - interval '9 seconds',
  now(),
  'maat_guidance_evaluate_hourly',
  1,
  'sent',
  jsonb_build_object(
    'trigger_reason', 'decan_day_5_maat',
    'cadence_type', 'decan_day_5',
    'cadence_mode', 'maat'
  ),
  now()
);

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  user_id,
  scheduled_for,
  cron_picked_at,
  function_started_at,
  delivered_at,
  cron_job_name,
  delivery_attempt,
  delivery_status,
  metadata,
  created_at
) values (
  'maat_guidance:00000000-0000-4000-8000-00000000d511',
  'drift_nudge',
  'maat_guidance_deliveries',
  '00000000-0000-4000-8000-00000000d511',
  '00000000-0000-4000-8000-00000000d510',
  now() - interval '20 seconds',
  now() - interval '18 seconds',
  now() - interval '18 seconds',
  now(),
  'maat_guidance_evaluate_hourly',
  1,
  'sent',
  jsonb_build_object(
    'trigger_reason', 'decan_day_5_isfet',
    'cadence_type', 'decan_day_5',
    'cadence_mode', 'isfet'
  ),
  now()
);

do $$
declare
  truth_count integer;
  recent_count integer;
  proof_count integer;
  isfet_truth_count integer;
  isfet_recent_count integer;
  isfet_proof_count integer;
begin
  select count(*) into truth_count
  from public.maat_output_truth_loop
  where output_id = '00000000-0000-4000-8000-00000000d501'
    and cadence_type = 'decan_day_5'
    and cadence_mode = 'maat'
    and trigger_reason = 'decan_day_5_maat'
    and cta_type = 'none';

  select count(*) into recent_count
  from public.maat_delivery_recent_events
  where target_id = '00000000-0000-4000-8000-00000000d501'
    and cadence_type = 'decan_day_5'
    and cadence_mode = 'maat'
    and trigger_reason = 'decan_day_5_maat'
    and delivery_status = 'sent';

  select count(*) into proof_count
  from public.maat_day5_cadence_delivery_proof
  where delivery_id = '00000000-0000-4000-8000-00000000d501'
    and cadence_type = 'decan_day_5'
    and cadence_mode = 'maat'
    and delivery_status = 'sent';

  select count(*) into isfet_truth_count
  from public.maat_output_truth_loop
  where output_id = '00000000-0000-4000-8000-00000000d511'
    and cadence_type = 'decan_day_5'
    and cadence_mode = 'isfet'
    and trigger_reason = 'decan_day_5_isfet'
    and cta_type <> 'none';

  select count(*) into isfet_recent_count
  from public.maat_delivery_recent_events
  where target_id = '00000000-0000-4000-8000-00000000d511'
    and cadence_type = 'decan_day_5'
    and cadence_mode = 'isfet'
    and trigger_reason = 'decan_day_5_isfet'
    and delivery_status = 'sent';

  select count(*) into isfet_proof_count
  from public.maat_day5_cadence_delivery_proof
  where delivery_id = '00000000-0000-4000-8000-00000000d511'
    and cadence_type = 'decan_day_5'
    and cadence_mode = 'isfet'
    and delivery_status = 'sent'
    and cta_type <> 'none';

  if truth_count <> 1 then
    raise exception 'Expected day-5 truth-loop row, got %', truth_count;
  end if;
  if recent_count <> 1 then
    raise exception 'Expected day-5 recent delivery row, got %', recent_count;
  end if;
  if proof_count <> 1 then
    raise exception 'Expected day-5 proof row, got %', proof_count;
  end if;
  if isfet_truth_count <> 1 then
    raise exception 'Expected Isfet day-5 truth-loop row, got %', isfet_truth_count;
  end if;
  if isfet_recent_count <> 1 then
    raise exception 'Expected Isfet day-5 recent delivery row, got %', isfet_recent_count;
  end if;
  if isfet_proof_count <> 1 then
    raise exception 'Expected Isfet day-5 proof row, got %', isfet_proof_count;
  end if;
end
$$;

select
  delivery_id,
  trigger_reason,
  cadence_type,
  cadence_mode,
  cta_type,
  delivery_status,
  delivery_latency_seconds
from public.maat_day5_cadence_delivery_proof
where delivery_id in (
  '00000000-0000-4000-8000-00000000d501',
  '00000000-0000-4000-8000-00000000d511'
)
order by cadence_mode;

rollback;
