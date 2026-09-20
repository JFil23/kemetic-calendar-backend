-- Deliver shared-calendar membership changes to clients that already have
-- the Inbox open. The app has always subscribed to these tables; without
-- publication membership those subscriptions can never receive a change.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'shared_calendar_members',
    'shared_calendar_notifications'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables publication_table
      where publication_table.pubname = 'supabase_realtime'
        and publication_table.schemaname = 'public'
        and publication_table.tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end
$$;

-- A Reading House is identified by the flow attached to its calendar, never
-- by mutable display copy. Keep the existing invite view as the one client
-- source and append the canonical flow identity needed by the Inbox.
create or replace view public.shared_calendar_invite_filing_items_client
with (security_invoker = true) as
select
  scm.calendar_id,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.icon as calendar_icon,
  sc.owner_id,
  scm.user_id as invitee_id,
  invitee_profile.handle as invitee_handle,
  invitee_profile.display_name as invitee_display_name,
  invitee_profile.avatar_url as invitee_avatar_url,
  scm.role,
  scm.status,
  scm.created_at as invited_at,
  scm.updated_at,
  scm.responded_at,
  scm.invited_by,
  inviter_profile.handle as inviter_handle,
  inviter_profile.display_name as inviter_display_name,
  case
    when scm.user_id = auth.uid() then 'incoming'
    when sc.owner_id = auth.uid() and scm.user_id <> auth.uid() then 'sent'
    else 'other'
  end as invite_direction,
  'calendar_invite'::text as item_kind,
  scm.status as lifecycle,
  (sc.deleted_at is null and scm.status = 'pending') as is_pending,
  jsonb_build_object(
    'item_kind', 'calendar_invite',
    'lifecycle', scm.status,
    'direction', case
      when scm.user_id = auth.uid() then 'incoming'
      when sc.owner_id = auth.uid() and scm.user_id <> auth.uid() then 'sent'
      else 'other'
    end,
    'calendar', jsonb_build_object(
      'calendar_id', sc.id,
      'calendar_name', sc.name,
      'calendar_color', sc.color,
      'owner_id', sc.owner_id
    ),
    'membership', jsonb_build_object(
      'role', scm.role,
      'status', scm.status,
      'invited_by', scm.invited_by,
      'invitee_id', scm.user_id
    ),
    'source_flow', jsonb_build_object(
      'flow_id', source_flow.source_flow_id,
      'flow_key', source_flow.source_flow_key,
      'book_title', source_flow.source_book_title
    )
  ) as filing_reasons,
  source_flow.source_flow_id,
  source_flow.source_flow_key,
  source_flow.source_book_title
from public.shared_calendar_members scm
join public.shared_calendars sc
  on sc.id = scm.calendar_id
left join public.profiles inviter_profile
  on inviter_profile.id = scm.invited_by
left join public.profiles invitee_profile
  on invitee_profile.id = scm.user_id
left join lateral (
  select
    flow.id as source_flow_id,
    'the-reading-house'::text as source_flow_key,
    coalesce(
      nullif(btrim(flow.ai_metadata #>> '{reading_house,book_title}'), ''),
      nullif(btrim(sc.name), ''),
      'Reading House'
    ) as source_book_title
  from public.flows flow
  where flow.calendar_id = sc.id
    and (
      flow.ai_metadata ->> 'flow_key' = 'the-reading-house'
      or coalesce(flow.notes, '') like '%maat=the-reading-house%'
    )
  order by flow.active desc, flow.id desc
  limit 1
) source_flow on true
where sc.deleted_at is null
  and scm.status = 'pending'
  and (
    scm.user_id = auth.uid()
    or (sc.owner_id = auth.uid() and scm.user_id <> auth.uid())
  );

revoke all on public.shared_calendar_invite_filing_items_client from public;
revoke all on public.shared_calendar_invite_filing_items_client from anon;
revoke all on public.shared_calendar_invite_filing_items_client
from authenticated;
grant select on public.shared_calendar_invite_filing_items_client
to authenticated;
grant select on public.shared_calendar_invite_filing_items_client
to service_role;

comment on view public.shared_calendar_invite_filing_items_client is
  'Client-safe pending shared-calendar invites with canonical source-flow identity. Incoming rows are visible to invitees; sent rows are owner-only.';

notify pgrst, 'reload schema';
