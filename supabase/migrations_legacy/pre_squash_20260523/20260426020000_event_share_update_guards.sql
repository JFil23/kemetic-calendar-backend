create or replace function public.enforce_event_share_update_guards()
returns trigger
language plpgsql
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Allow trusted backend and migration contexts that do not have auth.uid().
  if actor is null then
    return new;
  end if;

  if actor = new.sender_id and actor is distinct from new.recipient_id then
    if new.response_status is distinct from old.response_status
      or new.responded_at is distinct from old.responded_at
      or new.viewed_at is distinct from old.viewed_at
      or new.imported_at is distinct from old.imported_at then
      raise exception 'Only the recipient can change RSVP or read state on an event invite'
        using errcode = '42501';
    end if;
  end if;

  if actor = new.recipient_id and actor is distinct from new.sender_id then
    if new.event_id is distinct from old.event_id
      or new.sender_id is distinct from old.sender_id
      or new.recipient_id is distinct from old.recipient_id
      or new.channel is distinct from old.channel
      or new.invite_token is distinct from old.invite_token
      or new.invite_expires_at is distinct from old.invite_expires_at
      or new.sender_note is distinct from old.sender_note
      or new.status is distinct from old.status
      or new.payload_json is distinct from old.payload_json then
      raise exception 'Only the sender can change event invite metadata'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_event_shares_update_guards on public.event_shares;

create trigger trg_event_shares_update_guards
before update on public.event_shares
for each row
execute function public.enforce_event_share_update_guards();
