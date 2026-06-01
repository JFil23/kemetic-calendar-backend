-- Atomically claim due scheduled_notifications rows before push fan-out.
-- This prevents overlapping cron invocations from sending the same row twice
-- before one run gets a chance to mark it inactive.

alter table public.scheduled_notifications
  add column if not exists claimed_at timestamp with time zone,
  add column if not exists claim_token text;

create index if not exists idx_scheduled_notifications_due_claim
on public.scheduled_notifications (scheduled_at, claimed_at)
where (is_active = true);

create or replace function public.claim_due_scheduled_notifications(
  p_now timestamp with time zone default now(),
  p_limit integer default 500,
  p_lease_seconds integer default 900
)
returns table(
  id bigint,
  user_id uuid,
  client_event_id text,
  title text,
  body text,
  payload text,
  notification_type text,
  scheduled_at timestamp with time zone,
  claim_token text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_lease interval := make_interval(
    secs => greatest(coalesce(p_lease_seconds, 900), 30)
  );
  v_claim_token text := gen_random_uuid()::text;
begin
  return query
  with candidate_ids as (
    select sn.id
    from public.scheduled_notifications sn
    where sn.is_active = true
      and sn.scheduled_at <= p_now
      and (
        sn.claimed_at is null
        or sn.claimed_at < (p_now - v_lease)
      )
    order by sn.scheduled_at asc, sn.id asc
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.scheduled_notifications sn
    set claimed_at = p_now,
        claim_token = v_claim_token,
        updated_at = p_now
    from candidate_ids c
    where sn.id = c.id
    returning
      sn.id,
      sn.user_id,
      sn.client_event_id,
      sn.title,
      sn.body,
      sn.payload,
      sn.notification_type,
      sn.scheduled_at
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.client_event_id,
    claimed.title,
    claimed.body,
    claimed.payload,
    claimed.notification_type,
    claimed.scheduled_at,
    v_claim_token as claim_token
  from claimed;
end;
$$;

comment on function public.claim_due_scheduled_notifications(timestamp with time zone, integer, integer) is
'Atomically claims due scheduled_notifications rows using FOR UPDATE SKIP LOCKED and a lease token so overlapping cron runs do not send the same row concurrently.';

revoke all on function public.claim_due_scheduled_notifications(timestamp with time zone, integer, integer) from public;
grant execute on function public.claim_due_scheduled_notifications(timestamp with time zone, integer, integer) to service_role;
