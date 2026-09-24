begin;

-- Cut 2 only: reserve state for the later no-token lifecycle. A constant
-- integer default is metadata-only on supported PostgreSQL versions; there is
-- deliberately no historical UPDATE and no claim or delivery behavior change.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.scheduled_notifications
  add column no_token_attempt_count integer not null default 0,
  add column no_token_first_at timestamp with time zone,
  add column next_attempt_at timestamp with time zone,
  add column expires_at timestamp with time zone,
  add column token_available_at timestamp with time zone,
  add constraint scheduled_notifications_no_token_attempt_count_nonnegative
    check (no_token_attempt_count >= 0);

commit;
