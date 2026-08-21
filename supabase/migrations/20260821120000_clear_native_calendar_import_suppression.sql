-- Cut 2A compatibility primitive only. Native calendar rows are authoritative
-- projections, so Cut 2 may clear an exact historical suppression before
-- re-projecting an event that still exists on the device calendar.
create function public.clear_native_calendar_import_tombstone(
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

  -- This RPC is intentionally a no-op outside the canonical native namespace.
  -- The equality predicate below is the complete mutation scope: no prefix,
  -- range, calendar, or user-wide clearing is available.
  if v_client_event_id is null
    or left(v_client_event_id, char_length('native:')) <> 'native:' then
    return;
  end if;

  update public.event_deletion_trash as edt
     set purged_at = coalesce(edt.purged_at, timezone('utc', now())),
         suppresses_client = false,
         row_data = coalesce(edt.row_data, '{}'::jsonb) || jsonb_build_object(
           'cleared_by', 'native_calendar_reconcile',
           'cleared_at', timezone('utc', now())
         )
   where edt.user_id = v_uid
     and edt.client_event_id = v_client_event_id
     and edt.purged_at is null
     and edt.suppresses_client = true;
end;
$$;

revoke all on function public.clear_native_calendar_import_tombstone(text)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_native_calendar_import_tombstone(text)
  to authenticated;

comment on function public.clear_native_calendar_import_tombstone(text) is
'Clears only the authenticated user''s exact native-calendar suppression before authoritative reconciliation; it cannot mutate device calendars or ordinary HAw deletion state.';

notify pgrst, 'reload schema';
