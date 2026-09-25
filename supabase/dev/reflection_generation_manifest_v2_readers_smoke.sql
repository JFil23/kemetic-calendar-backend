-- Local-only Cut 11 smoke for Manifest v2 truth-reader compatibility.
-- Run after migrations against a disposable local DB. Everything rolls back.

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
  '00000000-0000-4000-8000-00000000f111',
  'authenticated',
  'authenticated',
  'cut11@example.test',
  'not-used',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

insert into public.reflection_generations (
  id,
  user_id,
  period_type,
  period_key,
  anchor_nodes,
  source_snapshot,
  generated_text,
  model_version,
  metadata,
  created_at
) values
(
  '00000000-0000-4000-8000-00000000c111',
  '00000000-0000-4000-8000-00000000f111',
  'decan',
  'cut11:paired',
  '["maat"]'::jsonb,
  '{"decan_reflection_id":"cut11-reflection"}'::jsonb,
  'The record names one anchor and one return.',
  'cut11-v1',
  jsonb_build_object(
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object(
        'kind', 'decan_reflection',
        'speechAct', 'witness'
      ),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 4.8,
        'deliveryRecommendation', 'archive_only',
        'repairMode', 'cadence_repair',
        'failureReasons', jsonb_build_array(
          'ceremonial_cadence_below_threshold'
        ),
        'actionClarityScore', 4.6
      ),
      'repair', jsonb_build_object(
        'attempted', true,
        'applied', true,
        'repair_mode', 'cadence_repair',
        'repair_reason', 'ceremonial_cadence_below_threshold',
        'pre_repair_text', 'Before repair.',
        'post_repair_text',
          'The record names one anchor and one return.',
        'grade_delta', jsonb_build_object(
          'ceremonial_cadence_score', 1
        )
      )
    )
  ),
  '2026-09-25T06:00:00Z'::timestamptz
),
(
  '00000000-0000-4000-8000-00000000c112',
  '00000000-0000-4000-8000-00000000f111',
  'decan',
  'cut11:paired',
  '["maat"]'::jsonb,
  '{"decan_reflection_id":"cut11-reflection"}'::jsonb,
  'The record names one anchor and one return.',
  'cut11-v2',
  jsonb_build_object(
    'manifest', jsonb_build_object(
      'version', 'reflection_generation_manifest_v2',
      'render', jsonb_build_object(
        'renderer', 'deterministic_spectrum',
        'used_llm', false,
        'llm_cost', 0
      ),
      'graph', jsonb_build_object(
        'lead_axis', 'truth',
        'destination', jsonb_build_object(
          'type', 'node',
          'ref', 'maat',
          'label', 'Read the guiding node'
        )
      ),
      'truth', jsonb_build_object(
        'surface', 'decan_reflection',
        'speech_act', 'witness',
        'delivery_channel', 'archive_only',
        'grade', jsonb_build_object(
          'pass', true,
          'guidance_worthiness_score', 4.8,
          'delivery_recommendation', 'archive_only',
          'repair_mode', 'cadence_repair',
          'failure_reasons', jsonb_build_array(
            'ceremonial_cadence_below_threshold'
          ),
          'action_clarity_score', 4.6
        ),
        'repair', jsonb_build_object(
          'attempted', true,
          'applied', true,
          'mode', 'cadence_repair',
          'reason', 'ceremonial_cadence_below_threshold',
          'pre_repair_text', 'Before repair.',
          'post_repair_text',
            'The record names one anchor and one return.',
          'grade_delta', jsonb_build_object(
            'ceremonial_cadence_score', 1
          )
        )
      )
    )
  ),
  '2026-09-25T06:00:00Z'::timestamptz
),
(
  '00000000-0000-4000-8000-00000000c113',
  '00000000-0000-4000-8000-00000000f111',
  'decan',
  'cut11:mixed',
  '["maat"]'::jsonb,
  '{"decan_reflection_id":"cut11-reflection"}'::jsonb,
  'The record names one anchor and one return.',
  'cut11-mixed',
  jsonb_build_object(
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object(
        'kind', 'wrong_v1_surface',
        'speechAct', 'wrong_v1_speech_act'
      ),
      'grade', jsonb_build_object(
        'pass', false,
        'deliveryRecommendation', 'wrong_v1_delivery'
      )
    ),
    'manifest', jsonb_build_object(
      'version', 'reflection_generation_manifest_v2',
      'truth', jsonb_build_object(
        'surface', 'decan_reflection',
        'speech_act', 'witness',
        'delivery_channel', 'archive_only',
        'grade', jsonb_build_object(
          'pass', true,
          'guidance_worthiness_score', 4.8,
          'delivery_recommendation', 'archive_only',
          'repair_mode', 'cadence_repair',
          'failure_reasons', jsonb_build_array(
            'ceremonial_cadence_below_threshold'
          ),
          'action_clarity_score', 4.6
        ),
        'repair', jsonb_build_object(
          'attempted', true,
          'applied', true,
          'mode', 'cadence_repair',
          'reason', 'ceremonial_cadence_below_threshold',
          'pre_repair_text', 'Before repair.',
          'post_repair_text',
            'The record names one anchor and one return.',
          'grade_delta', jsonb_build_object(
            'ceremonial_cadence_score', 1
          )
        )
      )
    )
  ),
  '2026-09-25T06:00:00Z'::timestamptz
),
(
  '00000000-0000-4000-8000-00000000c114',
  '00000000-0000-4000-8000-00000000f111',
  'decan',
  'cut11:unknown',
  '[]'::jsonb,
  '{"decan_reflection_id":"cut11-reflection"}'::jsonb,
  'Unknown manifest versions are not v2.',
  'cut11-unknown',
  '{"manifest":{"version":"reflection_generation_manifest_v999"}}'::jsonb,
  '2026-09-25T06:00:00Z'::timestamptz
);

do $$
declare
  v1_row jsonb;
  v2_row jsonb;
  mixed_row jsonb;
  v1_output_control jsonb;
begin
  select to_jsonb(v) - 'output_id' - 'output_control'
    into v1_row
  from public.maat_output_truth_loop v
  where v.output_id = '00000000-0000-4000-8000-00000000c111';

  select to_jsonb(v) - 'output_id' - 'output_control'
    into v2_row
  from public.maat_output_truth_loop v
  where v.output_id = '00000000-0000-4000-8000-00000000c112';

  if v1_row is null or v2_row is null or v1_row is distinct from v2_row then
    raise exception 'Paired v1/v2 truth projections are not equivalent';
  end if;

  select to_jsonb(v) - 'output_id' - 'decan_period_key' - 'output_control'
    into mixed_row
  from public.maat_output_truth_loop v
  where v.output_id = '00000000-0000-4000-8000-00000000c113';

  if mixed_row is distinct from
      (v2_row - 'decan_period_key') then
    raise exception 'Mixed v1/v2 truth row did not prefer Manifest v2';
  end if;

  if exists (
    select 1
    from public.maat_output_truth_loop
    where output_id = '00000000-0000-4000-8000-00000000c114'
  ) then
    raise exception 'Unknown manifest version masqueraded as supported v2';
  end if;

  select output_control
    into v1_output_control
  from public.maat_output_truth_loop
  where output_id = '00000000-0000-4000-8000-00000000c111';

  if v1_output_control is distinct from (
    select metadata -> 'output_control'
    from public.reflection_generations
    where id = '00000000-0000-4000-8000-00000000c111'
  ) then
    raise exception 'V1 output_control projection changed';
  end if;

  if (
    select output_control #> '{repair,pre_repair_text}'
    from public.maat_output_truth_loop
    where output_id = '00000000-0000-4000-8000-00000000c112'
  ) is distinct from '"Before repair."'::jsonb then
    raise exception 'V2 compact output_control lost review pre-repair text';
  end if;

  if (
    select output_control #> '{repair,post_repair_text}'
    from public.maat_output_truth_loop
    where output_id = '00000000-0000-4000-8000-00000000c112'
  ) is distinct from
      '"The record names one anchor and one return."'::jsonb then
    raise exception 'V2 compact output_control lost review post-repair text';
  end if;

  if exists (
    select 1
    from public.reflection_generations
    where id = '00000000-0000-4000-8000-00000000c112'
      and (
        metadata ? 'output_control'
        or source_snapshot ? 'output_control'
      )
  ) then
    raise exception 'Pure v2 fixture retained a bulky v1 output_control tree';
  end if;
end
$$;

rollback;
