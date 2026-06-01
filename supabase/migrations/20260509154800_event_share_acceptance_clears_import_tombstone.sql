-- A recipient explicitly accepting an event invite should override an exact
-- tombstone for that invite import. Otherwise a previous failed/missing-row
-- delete marker can make the RSVP update roll back with EVENT_RECENTLY_DELETED.

create or replace function public.clear_event_share_import_tombstone(
  p_user_id uuid,
  p_share_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_cid text;
begin
  if p_user_id is null or p_share_id is null then
    return;
  end if;

  v_target_cid := public.event_share_import_client_event_id(p_share_id);

  update public.event_deletion_trash
     set purged_at = coalesce(purged_at, timezone('utc', now())),
         suppresses_client = false,
         row_data = coalesce(row_data, '{}'::jsonb) || jsonb_build_object(
           'cleared_by', 'event_invite_acceptance',
           'cleared_at', timezone('utc', now()),
           'event_share_id', p_share_id::text
         )
   where user_id = p_user_id
     and client_event_id = v_target_cid
     and purged_at is null
     and suppresses_client = true;
end;
$$;

comment on function public.clear_event_share_import_tombstone(uuid, uuid) is
'Clears exact user_events tombstones for an event_share import when the recipient explicitly accepts that invite.';

create or replace function public.sync_event_share_calendar_copy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.recipient_id is not null then
      delete from public.user_events
      where user_id = old.recipient_id
        and client_event_id = public.event_share_import_client_event_id(old.id);
    end if;
    return old;
  end if;

  if coalesce(new.response_status, 'no_response') = 'accepted'
    and (
      tg_op = 'INSERT'
      or coalesce(old.response_status, 'no_response') <> 'accepted'
    ) then
    perform public.clear_event_share_import_tombstone(new.recipient_id, new.id);
  end if;

  perform public.sync_event_share_calendar_copy_from_row(new);
  return new;
end;
$$;

notify pgrst, 'reload schema';
