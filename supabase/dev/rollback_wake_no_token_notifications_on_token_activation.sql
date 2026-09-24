-- Cut 3 rollback only. Do not drop the Cut 2 lifecycle columns.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

drop trigger if exists wake_no_token_notifications_on_token_activation
on public.push_tokens;

drop function if exists
private.wake_no_token_notifications_on_token_activation();

commit;
