-- Local-only smoke test for Ma'at output truth-loop views.
-- Run after migrations against a disposable local DB:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dev/maat_output_truth_loop_smoke.sql
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
  '00000000-0000-4000-8000-00000000f001',
  'authenticated',
  'authenticated',
  'maat-output-smoke@example.test',
  'not-used',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

with seed as (
  select
    gs as n,
    case (gs % 3)
      when 0 then 'decan_opening'
      when 1 then 'drift_nudge'
      else 'strength_nudge'
    end as kind,
    (array[
      'pending',
      'shown',
      'opened',
      'dismissed',
      'acted',
      'expired',
      'archive_only'
    ])[((gs - 1) % 7) + 1] as status,
    now() - (gs || ' hours')::interval as created_at
  from generate_series(1, 24) as gs
),
inserted_guidance as (
  insert into public.maat_guidance_deliveries (
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
    shown_at,
    opened_at,
    dismissed_at,
    acted_at,
    expired_at,
    created_at,
    updated_at
  )
  select
    '00000000-0000-4000-8000-00000000f001'::uuid,
    kind,
    '2026-05-16:2026-05-25:smoke:' || n,
    status,
    case kind
      when 'decan_opening' then 10
      when 'drift_nudge' then 20
      else 30
    end,
    'Smoke teaser ' || n,
    'The record gives one anchor: smoke evidence ' || n ||
      '. Begin with measure: write one concrete mark. Keep the correction small and restorable.',
    jsonb_build_object(
      'delivery_channel',
        case when status = 'archive_only' then 'archive_only' else 'in_app_card' end,
      'output_control',
        jsonb_build_object(
          'plan', jsonb_build_object(
            'kind', kind,
            'speechAct',
              case kind
                when 'decan_opening' then 'orient'
                when 'drift_nudge' then 'correct'
                else 'fortify'
              end
          ),
          'validation', jsonb_build_object('ok', true),
          'grade', jsonb_build_object(
            'pass', status <> 'archive_only',
            'groundingScore', case when status = 'archive_only' then 3 else 5 end,
            'specificityScore', 5,
            'maatAlignmentScore', 5,
            'cadenceScore', 5,
            'ceremonialCadenceScore', case when status = 'archive_only' then 2 else 5 end,
            'actionClarityScore', 5,
            'surfaceFitScore', 5,
            'guidanceWorthinessScore', case when status = 'archive_only' then 3.95 else 5.0 end,
            'deliveryRecommendation',
              case when status = 'archive_only' then 'archive_only' else 'in_app_card' end,
            'repairMode', case when status = 'archive_only' then 'cadence_repair' else 'none' end,
            'failureReasons',
              case when status = 'archive_only'
                then jsonb_build_array('worthiness_below_interrupt_threshold')
                else '[]'::jsonb
              end
          )
        ),
      'output_telemetry',
        jsonb_build_object(
          'version', 'maat_output_truth_loop_v1',
          'delivery_channel',
            case when status = 'archive_only' then 'archive_only' else 'in_app_card' end,
          'was_interruptive', status <> 'archive_only',
          'local_hour_shown', 20,
          'user_session_state', 'returning',
          'dismissed_within_seconds',
            case when status = 'dismissed' then 4 else null end
        )
    ),
    'flow_template',
    'dawn-house-rite',
    'smoke',
    case when status in ('shown', 'opened', 'dismissed', 'acted') then created_at + interval '5 minutes' else null end,
    case when status in ('opened', 'acted') then created_at + interval '15 minutes' else null end,
    case when status = 'dismissed' then created_at + interval '5 minutes 4 seconds' else null end,
    case when status = 'acted' then created_at + interval '25 minutes' else null end,
    case when status = 'expired' then created_at + interval '30 minutes' else null end,
    created_at,
    created_at
  from seed
  returning id, user_id, created_at
)
insert into public.user_choice_events (
  user_id,
  event_type,
  metadata,
  created_at
)
select
  user_id,
  'suggestion_accepted',
  jsonb_build_object('delivery_id', id::text, 'source', 'maat_guidance'),
  created_at + interval '30 minutes'
from inserted_guidance
limit 4;

insert into public.journal_entries (
  user_id,
  greg_date,
  body,
  meta,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000f001',
  current_date,
  'Smoke journal follow-up.',
  '{}'::jsonb,
  now(),
  now()
);

insert into public.reflection_generations (
  user_id,
  period_type,
  period_key,
  generated_text,
  model_version,
  metadata,
  created_at
) values
(
  '00000000-0000-4000-8000-00000000f001',
  'decan',
  '2026-05-16:2026-05-25:smoke',
  'After repair, the record names one anchor and one return.',
  'smoke',
  jsonb_build_object(
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object('kind', 'decan_reflection', 'speechAct', 'witness'),
      'validation', jsonb_build_object('ok', true),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 4.8,
        'deliveryRecommendation', 'archive_only',
        'repairMode', 'none',
        'failureReasons', '[]'::jsonb
      ),
      'repair', jsonb_build_object(
        'attempted', true,
        'applied', true,
        'repair_mode', 'cadence_repair',
        'repair_reason', 'ceremonial_cadence_below_threshold',
        'pre_repair_text', 'Before repair, keep going and trust the process.',
        'post_repair_text', 'After repair, the record names one anchor and one return.',
        'grade_delta', jsonb_build_object(
          'ceremonial_cadence_score', 2,
          'guidance_worthiness_score', 0.7
        )
      )
    )
  ),
  now()
),
(
  '00000000-0000-4000-8000-00000000f001',
  'decan',
  '2026-05-16:2026-05-25:smoke',
  'The period is witnessed plainly and closes with one act.',
  'smoke',
  jsonb_build_object(
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object('kind', 'decan_reflection', 'speechAct', 'witness'),
      'validation', jsonb_build_object('ok', true),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 4.7,
        'deliveryRecommendation', 'archive_only',
        'repairMode', 'none',
        'failureReasons', '[]'::jsonb
      )
    )
  ),
  now()
);

do $$
declare
  guidance_count integer;
  all_output_count integer;
  archive_count integer;
  repaired_reflection_count integer;
  acted_count integer;
  fast_dismiss_count integer;
begin
  select count(*) into guidance_count
  from public.maat_guidance_output_truth_loop
  where user_id = '00000000-0000-4000-8000-00000000f001';

  select count(*) into all_output_count
  from public.maat_output_truth_loop
  where user_id = '00000000-0000-4000-8000-00000000f001';

  select count(*) into archive_count
  from public.maat_guidance_output_truth_loop
  where user_id = '00000000-0000-4000-8000-00000000f001'
    and status = 'archive_only'
    and delivery_channel = 'archive_only';

  select count(*) into repaired_reflection_count
  from public.maat_output_truth_loop
  where user_id = '00000000-0000-4000-8000-00000000f001'
    and source_type = 'reflection_generation'
    and repair_attempted
    and was_repaired;

  select count(*) into acted_count
  from public.maat_guidance_output_truth_loop
  where user_id = '00000000-0000-4000-8000-00000000f001'
    and status = 'acted'
    and user_acted;

  select count(*) into fast_dismiss_count
  from public.maat_guidance_output_truth_loop
  where user_id = '00000000-0000-4000-8000-00000000f001'
    and dismissed_within_seconds <= 5;

  if guidance_count <> 24 then
    raise exception 'Expected 24 guidance rows, got %', guidance_count;
  end if;
  if all_output_count <> 26 then
    raise exception 'Expected 26 total output rows, got %', all_output_count;
  end if;
  if archive_count = 0 then
    raise exception 'Expected archive-only guidance rows';
  end if;
  if repaired_reflection_count = 0 then
    raise exception 'Expected repaired reflection row';
  end if;
  if acted_count = 0 then
    raise exception 'Expected acted guidance row';
  end if;
  if fast_dismiss_count = 0 then
    raise exception 'Expected fast-dismiss interruption row';
  end if;
end $$;

select
  source_type,
  surface,
  status,
  delivery_channel,
  grade_passed,
  guidance_worthiness_score,
  repair_attempted,
  was_repaired,
  user_opened,
  user_acted,
  dismissed,
  dismissed_within_seconds
from public.maat_output_truth_loop
where user_id = '00000000-0000-4000-8000-00000000f001'
order by output_generated_at desc
limit 12;

rollback;
