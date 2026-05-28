alter table public.decan_reflection_schedule
  add column if not exists claim_token text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamp with time zone;

create index if not exists idx_decan_reflection_schedule_due_claim
on public.decan_reflection_schedule (send_at, claimed_at)
where status in ('pending', 'claimed');

create or replace function public.claim_due_decan_reflection_schedule(
  p_now timestamp with time zone default now(),
  p_limit integer default 25,
  p_lease_seconds integer default 900
)
returns table(
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
set search_path = public
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
    select drs.id
    from public.decan_reflection_schedule drs
    where drs.send_at <= p_now
      and (
        drs.status = 'pending'
        or (
          drs.status = 'claimed'
          and (
            drs.claimed_at is null
            or drs.claimed_at < (p_now - v_lease)
          )
        )
      )
    order by drs.send_at asc, drs.id asc
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.decan_reflection_schedule drs
    set status = 'claimed',
        claimed_at = p_now,
        claim_token = v_claim_token
    from candidate_ids c
    where drs.id = c.id
    returning
      drs.id,
      drs.user_id,
      drs.decan_start,
      drs.decan_end,
      drs.decan_name,
      drs.decan_theme,
      drs.decan_context_key,
      drs.attempt_count
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
    v_claim_token as claim_token
  from claimed;
end;
$$;

comment on function public.claim_due_decan_reflection_schedule(timestamp with time zone, integer, integer) is
'Atomically claims due decan_reflection_schedule rows using FOR UPDATE SKIP LOCKED and a lease token so interrupted cron runs can be retried safely.';

revoke all on function public.claim_due_decan_reflection_schedule(timestamp with time zone, integer, integer) from public;
grant execute on function public.claim_due_decan_reflection_schedule(timestamp with time zone, integer, integer) to service_role;
