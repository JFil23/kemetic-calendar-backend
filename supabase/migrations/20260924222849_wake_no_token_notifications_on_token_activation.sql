begin;

-- Cut 3 only: an active token can wake an existing, unexpired no-token wait.
-- Delivery, claiming, retry cadence, and lifecycle creation remain unchanged.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function private.wake_no_token_notifications_on_token_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if new.is_active is not true then
    return new;
  end if;

  -- Both registration paths upsert is_active = true. Do not turn an ordinary
  -- active-to-active refresh into a second product action for the same user.
  if tg_op = 'UPDATE'
     and old.is_active is true
     and old.user_id is not distinct from new.user_id then
    return new;
  end if;

  update public.scheduled_notifications as notification
     set token_available_at = v_now,
         next_attempt_at = v_now
   where notification.user_id = new.user_id
     and notification.is_active is true
     and notification.last_error = 'no_tokens_for_recipients'
     and notification.no_token_attempt_count > 0
     and notification.no_token_first_at is not null
     and notification.next_attempt_at is not null
     and notification.expires_at > v_now;

  return new;
end;
$$;

revoke all on function private.wake_no_token_notifications_on_token_activation()
from public, anon, authenticated, service_role;

comment on function private.wake_no_token_notifications_on_token_activation() is
'Cut 3: wake only an existing, active, unexpired no-token wait when a push token is inserted active or becomes active; never sends or claims notifications.';

create trigger wake_no_token_notifications_on_token_activation
after insert or update of is_active on public.push_tokens
for each row
execute function private.wake_no_token_notifications_on_token_activation();

commit;
