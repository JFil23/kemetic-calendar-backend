-- Ending a Reading House removes it from the owning account's active Inbox
-- while retaining its records for administrative history. No chat or
-- read-state rows are physically deleted by this lifecycle migration.
drop trigger if exists trg_delete_reading_house_room_on_flow_end
on public.flows;
drop function if exists private.delete_reading_house_room_on_flow_end();

-- The account-facing room list is live state, not an administrative archive.
-- Ended rooms disappear from the authenticated member's Inbox while their
-- underlying messages and read cursors remain available to backend admins.
create or replace view public.reading_house_room_summaries
with (security_invoker = true) as
select
  sc.id as calendar_id,
  f.id as flow_id,
  coalesce(
    nullif(f.ai_metadata ->> 'book_title', ''),
    nullif(regexp_replace(sc.name, '^Reading House · ', ''), ''),
    'Reading House'
  ) as house_title,
  latest.id as latest_message_id,
  latest.author_id as latest_author_id,
  latest.body as latest_message,
  latest.created_at as latest_message_at,
  latest_profile.display_name as latest_author_display_name,
  latest_profile.handle as latest_author_handle,
  coalesce(members.member_count, 0)::integer as member_count,
  coalesce(members.avatars, '[]'::jsonb) as members,
  read_state.last_read_at,
  (
    select count(*)::integer
    from public.reading_house_chat_messages unread
    where unread.calendar_id = sc.id
      and unread.flow_id = f.id
      and unread.deleted_at is null
      and unread.author_id <> (select auth.uid())
      and (
        read_state.last_read_at is null
        or unread.created_at > read_state.last_read_at
      )
  ) as unread_count,
  true as active,
  coalesce(members.member_count, 0) < 2 as locked,
  false as ended
from public.shared_calendar_members self_member
join public.shared_calendars sc
  on sc.id = self_member.calendar_id
join public.flows f
  on f.calendar_id = sc.id
left join public.reading_house_room_read_state read_state
  on read_state.calendar_id = sc.id
 and read_state.flow_id = f.id
 and read_state.user_id = self_member.user_id
left join lateral (
  select
    count(*)::integer as member_count,
    jsonb_agg(
      jsonb_build_object(
        'user_id', member.user_id,
        'role', member.role,
        'display_name', profile.display_name,
        'handle', profile.handle,
        'avatar_url', profile.avatar_url,
        'avatar_glyphs', profile.avatar_glyphs
      )
      order by
        case when member.role = 'owner' then 0 else 1 end,
        member.updated_at,
        member.user_id
    ) as avatars
  from public.shared_calendar_members member
  join public.profiles profile
    on profile.id = member.user_id
  where member.calendar_id = sc.id
    and member.status = 'accepted'
) members on true
left join lateral (
  select message.*
  from public.reading_house_chat_messages message
  where message.calendar_id = sc.id
    and message.flow_id = f.id
    and message.deleted_at is null
  order by message.created_at desc, message.id desc
  limit 1
) latest on true
left join public.profiles latest_profile
  on latest_profile.id = latest.author_id
where self_member.user_id = (select auth.uid())
  and self_member.status = 'accepted'
  and sc.deleted_at is null
  and coalesce(sc.is_personal, false) is false
  and f.active is true
  and coalesce(f.is_hidden, false) is false
  and not public.reading_house_is_solo_study_house(sc.id, f.id)
  and (
    f.ai_metadata ->> 'flow_key' = 'the-reading-house'
    or coalesce(f.notes, '') like '%maat=the-reading-house%'
  );

grant select on public.reading_house_room_summaries
to authenticated, service_role;

notify pgrst, 'reload schema';
