-- Native calendar imports are read-only projections. Historical HAw-side
-- deletes must not suppress an event that still exists in Apple/Google.
create or replace function public.clear_native_calendar_import_tombstone(
  p_client_event_id text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_client_event_id text := nullif(btrim(p_client_event_id), '');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_client_event_id is null
    or lower(v_client_event_id) not like 'native:%' then
    return;
  end if;

  update public.event_deletion_trash
     set purged_at = coalesce(purged_at, timezone('utc', now())),
         suppresses_client = false,
         row_data = coalesce(row_data, '{}'::jsonb) || jsonb_build_object(
           'cleared_by', 'native_calendar_reconcile',
           'cleared_at', timezone('utc', now())
         )
   where user_id = v_uid
     and client_event_id = v_client_event_id
     and purged_at is null
     and suppresses_client = true;
end;
$$;

revoke all on function public.clear_native_calendar_import_tombstone(text)
  from public;
grant execute on function public.clear_native_calendar_import_tombstone(text)
  to authenticated;

comment on function public.clear_native_calendar_import_tombstone(text) is
'Clears exact HAw deletion suppression before re-projecting an authoritative native calendar event.';

notify pgrst, 'reload schema';
