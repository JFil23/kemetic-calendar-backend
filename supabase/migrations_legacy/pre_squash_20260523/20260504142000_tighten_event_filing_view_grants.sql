revoke all on public.user_event_filing_items_client from public;
revoke all on public.user_event_filing_items_client from anon;
revoke all on public.user_event_filing_items_client from authenticated;

revoke all on public.user_event_filing_items from public;
revoke all on public.user_event_filing_items from anon;
revoke all on public.user_event_filing_items from authenticated;

grant select on public.user_event_filing_items_client to authenticated;
grant select on public.user_event_filing_items to authenticated;
grant select on public.user_event_filing_items_client to service_role;
grant select on public.user_event_filing_items to service_role;

revoke all on private.user_event_filing_items_internal from public;
revoke all on private.user_event_filing_items_internal from anon;
revoke all on private.user_event_filing_items_internal from authenticated;
grant select on private.user_event_filing_items_internal to service_role;

notify pgrst, 'reload schema';
