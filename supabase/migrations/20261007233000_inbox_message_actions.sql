-- Account-owned dismissal is separate from sender-owned unsending.
alter table public.flow_shares add column sender_hidden_at timestamptz;
alter table public.flow_shares add column recipient_hidden_at timestamptz;
alter table public.event_shares add column sender_hidden_at timestamptz;
alter table public.event_shares add column recipient_hidden_at timestamptz;
create table public.dm_message_hides (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, message_id)
);
alter table public.dm_message_hides enable row level security;
create policy dm_message_hides_owner_read on public.dm_message_hides
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.dm_message_hides to authenticated;
grant all on public.dm_message_hides to service_role;
create policy flow_shares_private_dismissal on public.flow_shares as restrictive
  for select to authenticated using (
    (sender_id <> (select auth.uid()) or sender_hidden_at is null)
    and (recipient_id is distinct from (select auth.uid()) or recipient_hidden_at is null));
create policy event_shares_private_dismissal on public.event_shares as restrictive
  for select to authenticated using (
    (sender_id <> (select auth.uid()) or sender_hidden_at is null)
    and (recipient_id is distinct from (select auth.uid()) or recipient_hidden_at is null));
create policy dm_messages_private_dismissal on public.dm_messages as restrictive
  for select to authenticated using (not exists (
    select 1 from public.dm_message_hides h
    where h.user_id = (select auth.uid()) and h.message_id = dm_messages.id));

create function public.inbox_message_action(p_kind text, p_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_sender uuid;
  v_recipient uuid;
  v_conversation uuid;
  v_table text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action not in ('hide', 'unsend') then raise exception 'INVALID_ACTION'; end if;
  if p_kind in ('flow','event') then
    v_table := case when p_kind = 'flow' then 'flow_shares' else 'event_shares' end;
    execute format('select sender_id,recipient_id from public.%I where id=$1 for update', v_table)
      into v_sender,v_recipient using p_id;
    if v_sender is null or (v_user is distinct from v_sender and v_user is distinct from v_recipient)
      then raise exception 'FORBIDDEN'; end if;
    if p_action = 'unsend' then
      if v_user <> v_sender then raise exception 'FORBIDDEN'; end if;
      execute format('update public.%I set deleted_at=coalesce(deleted_at,now()) where id=$1',v_table) using p_id;
    else
      execute format('update public.%I set %I=coalesce(%I,now()) where id=$1', v_table,
        case when v_user=v_sender then 'sender_hidden_at' else 'recipient_hidden_at' end,
        case when v_user=v_sender then 'sender_hidden_at' else 'recipient_hidden_at' end) using p_id;
    end if;
  elsif p_kind = 'dm' then
    select sender_id,conversation_id into v_sender,v_conversation
      from public.dm_messages where id=p_id for update;
    if v_sender is null or not public.dm_is_conversation_member(v_conversation,v_user)
      then raise exception 'FORBIDDEN'; end if;
    if p_action = 'unsend' then
      if v_user <> v_sender then raise exception 'FORBIDDEN'; end if;
      update public.dm_messages set deleted_at=coalesce(deleted_at,now()) where id=p_id;
    else
      insert into public.dm_message_hides(user_id,message_id) values(v_user,p_id)
        on conflict do nothing;
    end if;
  else raise exception 'INVALID_KIND'; end if;
  return true;
end $$;
revoke all on function public.inbox_message_action(text,uuid,text) from public,anon;
grant execute on function public.inbox_message_action(text,uuid,text) to authenticated;
-- Notifications contain only the owner's hide record, protected by its RLS.
alter publication supabase_realtime add table public.dm_message_hides;
