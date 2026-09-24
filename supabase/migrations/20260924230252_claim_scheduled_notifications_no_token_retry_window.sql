begin;

-- Cut 4 only: claim complete no-token lifecycle rows when their retry window
-- is due and unexpired. Incomplete/non-lifecycle rows retain legacy behavior.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

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
        (
          sn.last_error = 'no_tokens_for_recipients'
          and sn.no_token_attempt_count > 0
          and sn.no_token_first_at is not null
          and sn.next_attempt_at is not null
          and sn.expires_at is not null
        ) is not true
        or (
          sn.next_attempt_at <= p_now
          and (
            p_now < sn.expires_at
            or (
              sn.token_available_at is not null
              and sn.token_available_at < sn.expires_at
              and p_now <= sn.expires_at + interval '2 minutes'
            )
          )
        )
      )
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

commit;
