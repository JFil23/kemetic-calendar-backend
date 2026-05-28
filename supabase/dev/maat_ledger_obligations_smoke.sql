begin;

create temp table smoke_ids as
select
  gen_random_uuid() as user_id,
  gen_random_uuid() as delivery_id;

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
  user_id::text || '@maat-ledger-smoke.test',
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
  'drift_nudge',
  '2026-05-16:2026-05-25:smoke',
  'pending',
  50,
  'Tend to provision.',
  'Tend to provision by completing one nutrition check.',
  '{}'::jsonb,
  'flow_template',
  'dawn-house-rite',
  'smoke'
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
  last_delivery_id,
  metadata
)
select
  user_id,
  '2026-05-16:2026-05-25:smoke',
  '2026-05-16:2026-05-25:smoke:provision',
  'maat_snapshot_ledger',
  '2026-05-16:2026-05-25:smoke',
  'provision',
  'open',
  array['S', 'H', 'E'],
  array['blocked_flow', 'neglect'],
  2,
  0,
  1.5,
  1.5,
  '{"action":"complete one nutrition check and record it plainly","field":"provision","direction":"tend"}'::jsonb,
  delivery_id,
  '{"smoke":true}'::jsonb
from smoke_ids;

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
  metadata
)
select
  s.user_id,
  o.id,
  s.delivery_id,
  'drift_nudge',
  '2026-05-16:2026-05-25:smoke',
  'delivery:' || s.delivery_id::text,
  'provision',
  'complete one nutrition check and record it plainly',
  'tend',
  'flow_template',
  'dawn-house-rite',
  'smoke',
  'suggested',
  '{"smoke":true}'::jsonb
from smoke_ids s
join public.maat_obligations o
  on o.user_id = s.user_id
 and o.obligation_key = '2026-05-16:2026-05-25:smoke:provision';

update public.maat_restoration_attempts a
set status = 'acted',
    acted_at = now(),
    updated_at = now()
from smoke_ids s
where a.delivery_id = s.delivery_id;

update public.maat_obligations o
set status = 'acted',
    acted_at = now(),
    updated_at = now()
from smoke_ids s
where o.last_delivery_id = s.delivery_id;

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.maat_ledger_restoration_health h
  join smoke_ids s on s.user_id = h.user_id
  where h.field = 'provision'
    and h.obligation_status = 'acted'
    and h.acted_count = 1
    and h.last_attempt_status = 'acted';

  if v_rows <> 1 then
    raise exception 'maat ledger smoke expected 1 acted health row, got %', v_rows;
  end if;
end $$;

rollback;
