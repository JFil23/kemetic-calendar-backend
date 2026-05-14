create or replace view public.shared_calendar_summaries
with (security_invoker = true) as
select
  sc.id,
  sc.owner_id,
  sc.name,
  sc.color,
  sc.icon,
  sc.is_personal,
  sc.created_at,
  sc.updated_at,
  scm.user_id as member_user_id,
  scm.role,
  scm.status,
  owner_profile.handle as owner_handle,
  owner_profile.display_name as owner_display_name,
  (
    select count(*)::int
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'accepted'
  ) as member_count,
  (
    select count(*)::int
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'pending'
  ) as pending_invite_count
from public.shared_calendars sc
join public.shared_calendar_members scm
  on scm.calendar_id = sc.id
left join public.profiles owner_profile
  on owner_profile.id = sc.owner_id
where sc.deleted_at is null
  and scm.user_id = auth.uid()
  and scm.status = 'accepted';

create or replace view public.shared_calendar_pending_invites
with (security_invoker = true) as
select
  scm.calendar_id,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.icon as calendar_icon,
  sc.owner_id,
  scm.role,
  scm.created_at as invited_at,
  scm.invited_by,
  inviter_profile.handle as inviter_handle,
  inviter_profile.display_name as inviter_display_name
from public.shared_calendar_members scm
join public.shared_calendars sc
  on sc.id = scm.calendar_id
left join public.profiles inviter_profile
  on inviter_profile.id = scm.invited_by
where sc.deleted_at is null
  and scm.user_id = auth.uid()
  and scm.status = 'pending';

create or replace view public.user_events_with_calendars
with (security_invoker = true) as
select
  ue.*,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.is_personal as calendar_is_personal
from public.user_events ue
join public.shared_calendars sc
  on sc.id = ue.calendar_id
where sc.deleted_at is null;

grant select on public.shared_calendar_summaries to authenticated;
grant select on public.shared_calendar_pending_invites to authenticated;
grant select on public.user_events_with_calendars to authenticated;

notify pgrst, 'reload schema';
