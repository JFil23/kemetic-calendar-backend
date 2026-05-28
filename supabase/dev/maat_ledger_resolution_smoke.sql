begin;

create temp table smoke_ids as
select
  gen_random_uuid() as user_id,
  gen_random_uuid() as provision_delivery_id,
  gen_random_uuid() as todo_delivery_id,
  gen_random_uuid() as flow_delivery_id,
  gen_random_uuid() as release_delivery_id,
  gen_random_uuid() as todo_id,
  gen_random_uuid() as exact_todo_id,
  gen_random_uuid() as flow_id;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  created_at,
  updated_at
)
select
  user_id,
  'authenticated',
  'authenticated',
  user_id::text || '@maat-ledger-resolution-smoke.test',
  now(),
  now(),
  now()
from smoke_ids;

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
  trigger_reason
)
select
  delivery_id,
  user_id,
  kind,
  '2026-05-16:2026-05-25:resolution-smoke',
  'expired',
  50,
  teaser_text,
  body_text,
  '{}'::jsonb,
  cta_type,
  cta_ref,
  'resolution_smoke'
from smoke_ids,
lateral (
  values
    (
      provision_delivery_id,
      'drift_nudge',
      'Tend to provision.',
      'Tend to provision by completing one nutrition check.',
      'flow_template',
      'nutrition-restoration'
    ),
    (
      todo_delivery_id,
      'drift_nudge',
      'Tend to visible work.',
      'Tend to visible work by completing one to-do.',
      'flow_template',
      'todo-restoration'
    ),
    (
      flow_delivery_id,
      'drift_nudge',
      'Open the restoring flow.',
      'Open the restoring flow and complete it.',
      'flow',
      flow_id::text
    ),
    (
      release_delivery_id,
      'drift_nudge',
      'Reduce the account.',
      'Release what is no longer rightly held.',
      'none',
      null
    )
) as deliveries(
  delivery_id,
  kind,
  teaser_text,
  body_text,
  cta_type,
  cta_ref
);

insert into public.maat_obligations (
  user_id,
  decan_period_key,
  obligation_key,
  source_type,
  source_id,
  field,
  status,
  axis_codes,
  isfet_patterns,
  open_count,
  broken_count,
  leak_score,
  weight,
  suggested_restoration,
  last_delivery_id,
  metadata
)
select
  user_id,
  '2026-05-16:2026-05-25:resolution-smoke',
  '2026-05-16:2026-05-25:resolution-smoke:' || field,
  'maat_snapshot_ledger',
  '2026-05-16:2026-05-25:resolution-smoke',
  field,
  'acted',
  array['S', 'H', 'E'],
  array['blocked_flow', 'neglect'],
  2,
  0,
  1.5,
  1.5,
  jsonb_build_object('action', action_text, 'field', field, 'direction', direction),
  delivery_id,
  '{}'::jsonb
from smoke_ids,
lateral (
  values
    (
      'provision',
      'complete one nutrition check and record it plainly',
      'tend',
      provision_delivery_id
    ),
    (
      'visible_work',
      'complete one to-do with a clear finish condition',
      'tend',
      todo_delivery_id
    ),
    (
      'measure',
      'complete the suggested restoring flow',
      'engage',
      flow_delivery_id
    ),
    (
      'cohesion',
      'release one false obligation',
      'release',
      release_delivery_id
    )
) as obligations(field, action_text, direction, delivery_id);

insert into public.maat_restoration_attempts (
  user_id,
  obligation_id,
  delivery_id,
  delivery_kind,
  decan_period_key,
  attempt_key,
  field,
  action_text,
  direction,
  cta_type,
  cta_ref,
  trigger_reason,
  status,
  acted_at,
  metadata
)
select
  o.user_id,
  o.id,
  o.last_delivery_id,
  'drift_nudge',
  o.decan_period_key,
  'delivery:' || o.last_delivery_id::text,
  o.field,
  o.suggested_restoration ->> 'action',
  o.suggested_restoration ->> 'direction',
  d.cta_type,
  d.cta_ref,
  'resolution_smoke',
  'acted',
  now(),
  case
    when o.field = 'measure' then jsonb_build_object('flow_id', s.flow_id::text)
    else '{}'::jsonb
  end
from public.maat_obligations o
join smoke_ids s on s.user_id = o.user_id
join public.maat_guidance_deliveries d on d.id = o.last_delivery_id
where o.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke';

insert into public.maat_obligations (
  user_id,
  decan_period_key,
  obligation_key,
  source_type,
  source_id,
  field,
  status,
  axis_codes,
  isfet_patterns,
  open_count,
  broken_count,
  leak_score,
  weight,
  suggested_restoration,
  metadata,
  acted_at
)
select
  user_id,
  '2026-05-06:2026-05-15:resolution-smoke-old',
  '2026-05-06:2026-05-15:resolution-smoke-old:visible_work',
  'maat_snapshot_ledger',
  '2026-05-06:2026-05-15:resolution-smoke-old',
  'visible_work',
  'acted',
  array['M', 'C', 'S'],
  array['broken_obligation', 'blocked_flow'],
  1,
  0,
  1,
  1,
  '{"action":"complete one old to-do","field":"visible_work","direction":"tend"}'::jsonb,
  '{}'::jsonb,
  now() - interval '2 days'
from smoke_ids;

insert into public.todos (
  id,
  user_id,
  title,
  due_date,
  status,
  completed_at
)
select
  todo_id,
  user_id,
  'Finish one visible task',
  date '2026-05-23',
  'done',
  now()
from smoke_ids;

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke'
    and h.field = 'visible_work'
    and h.obligation_status = 'resolved'
    and h.resolution_source_type = 'todo'
    and h.resolution_confidence = 'same_axis_same_decan';

  if v_rows <> 1 then
    raise exception 'expected current visible work obligation to resolve from same-decan todo, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.decan_period_key = '2026-05-06:2026-05-15:resolution-smoke-old'
    and h.field = 'visible_work'
    and h.obligation_status = 'acted';

  if v_rows <> 1 then
    raise exception 'expected old visible work obligation to stay acted, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke'
    and h.field = 'provision'
    and h.obligation_status = 'acted'
    and h.resolved_count = 0;

  if v_rows <> 1 then
    raise exception 'expected provision obligation to remain acted after unrelated todo, got %', v_rows;
  end if;
end $$;

insert into public.maat_obligations (
  user_id,
  decan_period_key,
  obligation_key,
  source_type,
  source_id,
  field,
  status,
  axis_codes,
  isfet_patterns,
  open_count,
  broken_count,
  leak_score,
  weight,
  suggested_restoration,
  metadata,
  acted_at
)
select
  user_id,
  '2026-05-16:2026-05-25:resolution-smoke',
  '2026-05-16:2026-05-25:resolution-smoke:visible_work:exact',
  'todo',
  exact_todo_id::text,
  'visible_work',
  'acted',
  array['M', 'C', 'S'],
  array['broken_obligation', 'blocked_flow'],
  1,
  0,
  1,
  1,
  jsonb_build_object(
    'action',
    'complete the exact source todo',
    'field',
    'visible_work',
    'direction',
    'tend',
    'source_id',
    exact_todo_id::text
  ),
  jsonb_build_object('source_id', exact_todo_id::text),
  now()
from smoke_ids;

insert into public.maat_obligations (
  user_id,
  decan_period_key,
  obligation_key,
  source_type,
  source_id,
  field,
  status,
  axis_codes,
  isfet_patterns,
  open_count,
  broken_count,
  leak_score,
  weight,
  suggested_restoration,
  metadata,
  acted_at
)
select
  user_id,
  '2026-05-16:2026-05-25:resolution-smoke',
  '2026-05-16:2026-05-25:resolution-smoke:visible_work:same-decan',
  'maat_snapshot_ledger',
  'same-decan-only',
  'visible_work',
  'acted',
  array['M', 'C', 'S'],
  array['broken_obligation', 'blocked_flow'],
  1,
  0,
  1,
  1,
  '{"action":"complete one same-decan task","field":"visible_work","direction":"tend"}'::jsonb,
  '{}'::jsonb,
  now()
from smoke_ids;

insert into public.todos (
  id,
  user_id,
  title,
  due_date,
  status,
  completed_at
)
select
  exact_todo_id,
  user_id,
  'Finish the exact source task',
  date '2026-05-23',
  'done',
  now()
from smoke_ids;

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.obligation_key = '2026-05-16:2026-05-25:resolution-smoke:visible_work:exact'
    and h.obligation_status = 'resolved'
    and h.resolution_source_type = 'todo'
    and h.resolution_source_id = s.exact_todo_id::text
    and h.resolution_confidence = 'exact_source_match';

  if v_rows <> 1 then
    raise exception 'expected exact source visible work obligation to win, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.obligation_key = '2026-05-16:2026-05-25:resolution-smoke:visible_work:same-decan'
    and h.obligation_status = 'acted'
    and h.resolution_source_type is null;

  if v_rows <> 1 then
    raise exception 'expected same-decan competitor to stay acted when exact source exists, got %', v_rows;
  end if;
end $$;

insert into public.maat_obligations (
  user_id,
  decan_period_key,
  obligation_key,
  source_type,
  source_id,
  field,
  status,
  axis_codes,
  isfet_patterns,
  open_count,
  broken_count,
  leak_score,
  weight,
  suggested_restoration,
  metadata,
  acted_at
)
select
  user_id,
  '2026-04-06:2026-04-15:resolution-smoke-weak',
  '2026-04-06:2026-04-15:resolution-smoke-weak:truthful_record',
  'maat_snapshot_ledger',
  'truthful-record-old',
  'truthful_record',
  'acted',
  array['T', 'M'],
  array['falsehood', 'distorted_measure'],
  1,
  0,
  1,
  1,
  '{"action":"write one truthful mark","field":"truthful_record","direction":"strengthen"}'::jsonb,
  '{}'::jsonb,
  now() - interval '2 days'
from smoke_ids;

select public.resolve_maat_obligations_for_field(
  user_id,
  'truthful_record',
  'journal_entry',
  'unmatched-journal-entry',
  '{"smoke":true}'::jsonb,
  now(),
  date '2026-05-23',
  null,
  'unmatched-journal-entry'
)
from smoke_ids;

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.obligation_key = '2026-04-06:2026-04-15:resolution-smoke-weak:truthful_record'
    and h.obligation_status = 'acted'
    and h.resolution_source_type is null
    and h.resolved_count = 0
    and h.needs_scope_reduction = true;

  if v_rows <> 1 then
    raise exception 'expected weak fallback truthful record to remain acted, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.maat_obligations o
  join smoke_ids s on s.user_id = o.user_id
  where o.obligation_key = '2026-04-06:2026-04-15:resolution-smoke-weak:truthful_record'
    and o.metadata ->> 'last_weak_resolution_confidence' = 'fallback_axis_match'
    and o.metadata ->> 'last_weak_resolution_source_type' = 'journal_entry';

  if v_rows <> 1 then
    raise exception 'expected weak fallback metadata without closure, got %', v_rows;
  end if;
end $$;

insert into public.journal_badges (
  user_id,
  badge_id,
  title,
  tags,
  occurred_on,
  occurred_at,
  event_id
)
select
  user_id,
  'nutrition:done:bee-bread',
  'Bee bread',
  array['planner', 'kind:nutrition', 'state:done'],
  date '2026-05-23',
  now(),
  'nutrition:bee-bread'
from smoke_ids;

insert into public.user_choice_events (
  user_id,
  event_type,
  flow_id,
  metadata
)
select
  user_id,
  'flow_completed',
  flow_id,
  jsonb_build_object('flow_id', flow_id::text, 'source', 'resolution_smoke')
from smoke_ids;

select set_config('request.jwt.claim.sub', user_id::text, true)
from smoke_ids;

select public.release_maat_obligation(
  o.id,
  'scope narrowed in smoke test',
  'smoke_release',
  'release-1',
  '{"smoke":true}'::jsonb
)
from public.maat_obligations o
join smoke_ids s on s.user_id = o.user_id
where o.field = 'cohesion'
  and o.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke';

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke'
    and h.field = 'provision'
    and h.obligation_status = 'resolved'
    and h.resolved_count = 1
    and h.acted_count = 1
    and h.acted_to_resolved_rate = 1
    and h.resolution_source_type = 'planner_badge'
    and h.resolution_confidence = 'same_axis_same_decan'
    and h.last_attempt_status = 'resolved';

  if v_rows <> 1 then
    raise exception 'expected provision obligation to resolve from nutrition badge, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke'
    and h.field = 'visible_work'
    and h.obligation_status = 'resolved'
    and h.resolved_count = 1
    and h.resolution_source_type = 'todo'
    and h.resolution_confidence = 'same_axis_same_decan'
    and h.last_attempt_status = 'resolved';

  if v_rows <> 1 then
    raise exception 'expected visible work obligation to resolve from completed todo, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke'
    and h.field = 'measure'
    and h.obligation_status = 'resolved'
    and h.resolved_count = 1
    and h.resolution_source_type = 'flow_completed'
    and h.resolution_confidence = 'exact_source_match'
    and h.last_attempt_status = 'resolved';

  if v_rows <> 1 then
    raise exception 'expected measure obligation to resolve from completed flow, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.decan_period_key = '2026-05-16:2026-05-25:resolution-smoke'
    and h.field = 'cohesion'
    and h.obligation_status = 'released'
    and h.released_count = 1
    and h.release_source_type = 'smoke_release'
    and h.last_attempt_status = 'released';

  if v_rows <> 1 then
    raise exception 'expected cohesion obligation to release, got %', v_rows;
  end if;
end $$;

rollback;
