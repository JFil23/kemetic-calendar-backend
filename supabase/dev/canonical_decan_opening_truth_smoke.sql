-- Local-only Cut 9 smoke for canonical decan-opening truth authority.
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
) values
(
  '00000000-0000-4000-8000-00000000f091',
  'authenticated',
  'authenticated',
  'cut9-a@example.test',
  'not-used',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000f092',
  'authenticated',
  'authenticated',
  'cut9-b@example.test',
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
  generated_text,
  model_version,
  metadata,
  generation_key,
  created_at
) values
(
  '00000000-0000-4000-8000-00000000c901',
  '00000000-0000-4000-8000-00000000f091',
  'decan',
  'cut9:ordinary',
  'Cut 9 ordinary decan truth row.',
  'cut9-smoke',
  jsonb_build_object(
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object(
        'kind', 'decan_reflection',
        'speechAct', 'witness'
      ),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 4.8,
        'deliveryRecommendation', 'archive_only'
      )
    )
  ),
  null,
  now() - interval '7 minutes'
),
(
  '00000000-0000-4000-8000-00000000c902',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:legacy-canonical',
  'Cut 9 canonical legacy opening.',
  'cut9-smoke',
  jsonb_build_object(
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object('kind', 'decan_opening', 'speechAct', 'orient'),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 5.0,
        'deliveryRecommendation', 'in_app_card'
      )
    )
  ),
  null,
  now() - interval '6 minutes'
),
(
  '00000000-0000-4000-8000-00000000c903',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:keyed-canonical',
  'Cut 9 canonical keyed opening.',
  'cut9-smoke',
  jsonb_build_object(
    'output_control', jsonb_build_object(
      'plan', jsonb_build_object('kind', 'decan_opening', 'speechAct', 'orient'),
      'grade', jsonb_build_object(
        'pass', true,
        'guidanceWorthinessScore', 5.0,
        'deliveryRecommendation', 'in_app_card'
      )
    )
  ),
  'cut9:keyed-canonical-generation',
  now() - interval '5 minutes'
),
(
  '00000000-0000-4000-8000-00000000c904',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:legacy-canonical',
  'Cut 9 historical duplicate one.',
  'cut9-smoke',
  '{"output_control":{"plan":{"kind":"decan_opening"}}}'::jsonb,
  null,
  now() - interval '4 minutes'
),
(
  '00000000-0000-4000-8000-00000000c905',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:legacy-canonical',
  'Cut 9 historical duplicate two.',
  'cut9-smoke',
  '{"output_control":{"plan":{"kind":"decan_opening"}}}'::jsonb,
  null,
  now() - interval '3 minutes'
),
(
  '00000000-0000-4000-8000-00000000c906',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:mismatched-user',
  'Cut 9 mismatched-user opening.',
  'cut9-smoke',
  '{"output_control":{"plan":{"kind":"decan_opening"}}}'::jsonb,
  null,
  now() - interval '2 minutes'
),
(
  '00000000-0000-4000-8000-00000000c907',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:mismatched-period-source',
  'Cut 9 mismatched-period opening.',
  'cut9-smoke',
  '{"output_control":{"plan":{"kind":"decan_opening"}}}'::jsonb,
  null,
  now() - interval '1 minute'
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
  generation_id,
  trigger_reason,
  created_at,
  updated_at
) values
(
  '00000000-0000-4000-8000-00000000d901',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:legacy-canonical',
  'pending',
  10,
  'Canonical legacy',
  'Canonical legacy body',
  '{"output_control":{"plan":{"kind":"decan_opening","speechAct":"orient"}}}'::jsonb,
  'none',
  '00000000-0000-4000-8000-00000000c902',
  'cut9-smoke',
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d902',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:keyed-canonical',
  'pending',
  10,
  'Canonical keyed',
  'Canonical keyed body',
  '{"output_control":{"plan":{"kind":"decan_opening","speechAct":"orient"}}}'::jsonb,
  'none',
  '00000000-0000-4000-8000-00000000c903',
  'cut9-smoke',
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d903',
  '00000000-0000-4000-8000-00000000f092',
  'decan_opening',
  'cut9:mismatched-user',
  'pending',
  10,
  'Mismatched user',
  'Mismatched user body',
  '{"output_control":{"plan":{"kind":"decan_opening","speechAct":"orient"}}}'::jsonb,
  'none',
  '00000000-0000-4000-8000-00000000c906',
  'cut9-smoke',
  now(),
  now()
),
(
  '00000000-0000-4000-8000-00000000d904',
  '00000000-0000-4000-8000-00000000f091',
  'decan_opening',
  'cut9:mismatched-period-delivery',
  'pending',
  10,
  'Mismatched period',
  'Mismatched period body',
  '{"output_control":{"plan":{"kind":"decan_opening","speechAct":"orient"}}}'::jsonb,
  'none',
  '00000000-0000-4000-8000-00000000c907',
  'cut9-smoke',
  now(),
  now()
);

do $$
declare
  actual_column_names text[];
  actual_column_types text[];
  ordinary_count integer;
  opening_count integer;
  guidance_count integer;
  guidance_mismatch_count integer;
  noncanonical_count integer;
  duplicate_count integer;
  canonical_mismatch_count integer;
begin
  select
    array_agg(a.attname order by a.attnum),
    array_agg(format_type(a.atttypid, a.atttypmod) order by a.attnum)
  into actual_column_names, actual_column_types
  from pg_attribute a
  where a.attrelid = 'public.maat_output_truth_loop'::regclass
    and a.attnum > 0
    and not a.attisdropped;

  if actual_column_names is distinct from array[
    'output_id','source_type','user_id','surface','speech_act',
    'decan_period_key','status','trigger_reason','cta_type','cta_ref',
    'delivery_channel','teaser_text','body_text','output_generated_at',
    'shown_at','opened_at','dismissed_at','acted_at','expired_at','grade',
    'grade_passed','guidance_worthiness_score','delivery_recommendation',
    'repair_attempted','was_repaired','repair_mode','repair_reason',
    'repair_grade_delta','user_opened','user_acted','dismissed',
    'was_interruptive','local_hour_shown','user_session_state',
    'dismissed_within_seconds','time_to_open_minutes','time_to_act_minutes',
    'followup_behavior_window','output_telemetry','output_control',
    'cadence_type','cadence_mode'
  ]::text[] then
    raise exception 'Cut 9 changed the maat_output_truth_loop column contract';
  end if;

  if actual_column_types is distinct from array[
    'text','text','uuid','text','text','text','text','text','text','text',
    'text','text','text','timestamp with time zone','timestamp with time zone',
    'timestamp with time zone','timestamp with time zone',
    'timestamp with time zone','timestamp with time zone','jsonb','boolean',
    'numeric','text','boolean','boolean','text','text','jsonb','boolean',
    'boolean','boolean','boolean','integer','text','numeric','numeric',
    'numeric','jsonb','jsonb','jsonb','text','text'
  ]::text[] then
    raise exception 'Cut 9 changed the maat_output_truth_loop column types';
  end if;

  if (
    select pg_get_userbyid(c.relowner) <> 'postgres'
      or not coalesce(c.reloptions @> array['security_invoker=true'], false)
    from pg_class c
    where c.oid = 'public.maat_output_truth_loop'::regclass
  ) then
    raise exception 'Cut 9 changed view ownership or security behavior';
  end if;

  if not has_table_privilege('anon', 'public.maat_output_truth_loop', 'select')
     or not has_table_privilege(
       'authenticated', 'public.maat_output_truth_loop', 'select'
     )
     or not has_table_privilege(
       'service_role', 'public.maat_output_truth_loop', 'select'
     ) then
    raise exception 'Cut 9 changed the view SELECT ACL';
  end if;

  select count(*) into ordinary_count
  from public.maat_output_truth_loop
  where source_type = 'reflection_generation'
    and output_id = '00000000-0000-4000-8000-00000000c901'
    and surface = 'decan_reflection'
    and body_text = 'Cut 9 ordinary decan truth row.'
    and output_control #>> '{plan,speechAct}' = 'witness';

  if ordinary_count <> 1 then
    raise exception 'Ordinary decan truth row changed or disappeared';
  end if;

  select count(*) into opening_count
  from public.maat_output_truth_loop
  where source_type = 'reflection_generation'
    and output_id in (
      '00000000-0000-4000-8000-00000000c902',
      '00000000-0000-4000-8000-00000000c903'
    );

  if opening_count <> 2 then
    raise exception 'Expected one canonical legacy and one canonical keyed opening';
  end if;

  if not exists (
    select 1
    from public.maat_output_truth_loop v
    join public.reflection_generations r on r.id::text = v.output_id
    where v.output_id = '00000000-0000-4000-8000-00000000c902'
      and r.generation_key is null
  ) or not exists (
    select 1
    from public.maat_output_truth_loop v
    join public.reflection_generations r on r.id::text = v.output_id
    where v.output_id = '00000000-0000-4000-8000-00000000c903'
      and r.generation_key = 'cut9:keyed-canonical-generation'
  ) then
    raise exception 'Legacy/keyed canonical opening treatment is incorrect';
  end if;

  select count(*) into noncanonical_count
  from public.maat_output_truth_loop
  where source_type = 'reflection_generation'
    and output_id in (
      '00000000-0000-4000-8000-00000000c904',
      '00000000-0000-4000-8000-00000000c905',
      '00000000-0000-4000-8000-00000000c906',
      '00000000-0000-4000-8000-00000000c907'
    );

  if noncanonical_count <> 0 then
    raise exception 'A duplicate or mismatched opening leaked into truth output';
  end if;

  select count(*) into canonical_mismatch_count
  from public.maat_output_truth_loop v
  join public.reflection_generations r on r.id::text = v.output_id
  where v.source_type = 'reflection_generation'
    and r.period_type = 'decan_opening'
    and r.user_id in (
      '00000000-0000-4000-8000-00000000f091',
      '00000000-0000-4000-8000-00000000f092'
    )
    and not exists (
      select 1
      from public.maat_guidance_deliveries d
      where d.kind = 'decan_opening'
        and d.generation_id = r.id
        and d.user_id = r.user_id
        and d.decan_period_key = r.period_key
    );

  if canonical_mismatch_count <> 0 then
    raise exception 'Opening truth output escaped canonical pointer authority';
  end if;

  select count(*) into duplicate_count
  from (
    select v.output_id
    from public.maat_output_truth_loop v
    where v.source_type = 'reflection_generation'
      and v.output_id in (
        '00000000-0000-4000-8000-00000000c902',
        '00000000-0000-4000-8000-00000000c903'
      )
    group by v.output_id
    having count(*) > 1
  ) duplicates;

  if duplicate_count <> 0 then
    raise exception 'EXISTS canonicalization multiplied opening truth rows';
  end if;

  select count(*) into guidance_count
  from public.maat_output_truth_loop
  where source_type = 'maat_guidance_delivery'
    and output_id in (
      '00000000-0000-4000-8000-00000000d901',
      '00000000-0000-4000-8000-00000000d902',
      '00000000-0000-4000-8000-00000000d903',
      '00000000-0000-4000-8000-00000000d904'
    );

  if guidance_count <> 4 then
    raise exception 'Guidance truth branch lost fixture rows';
  end if;

  select count(*) into guidance_mismatch_count
  from public.maat_guidance_output_truth_loop g
  left join public.maat_output_truth_loop v
    on v.source_type = 'maat_guidance_delivery'
   and v.output_id = g.delivery_id::text
  where g.delivery_id in (
      '00000000-0000-4000-8000-00000000d901',
      '00000000-0000-4000-8000-00000000d902',
      '00000000-0000-4000-8000-00000000d903',
      '00000000-0000-4000-8000-00000000d904'
    )
    and (
      v.output_id is null
      or (to_jsonb(v) - 'output_id' - 'source_type') is distinct from
        ((to_jsonb(g) - 'delivery_id') || '{"output_control":null}'::jsonb)
    );

  if guidance_mismatch_count <> 0 then
    raise exception 'Guidance truth branch semantics changed';
  end if;
end
$$;

rollback;
