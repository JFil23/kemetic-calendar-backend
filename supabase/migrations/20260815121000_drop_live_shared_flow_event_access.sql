-- Flow shares carry a client-safe snapshot in flow_shares.payload_json.
-- They are not live collaboration grants. The shared calendar membership
-- policy remains the authority for calendars that intentionally collaborate.
drop policy if exists "user_events_select_shared_flow_events"
  on public.user_events;
