-- Keep the startup flow catalog on an index-driven, user-scoped path.
--
-- The mobile client reads this view before calendar hydration. The historical
-- correlated membership predicate could repeatedly evaluate the authenticated
-- user while scanning flows. This index supports starting from the caller's
-- accepted calendar memberships, and the view resolves auth.uid() once.

create index if not exists shared_calendar_members_user_calendar_accepted_idx
on public.shared_calendar_members (user_id, calendar_id)
where status = 'accepted';

create or replace view public.flows_with_calendars
with (security_invoker = true) as
with uid_ctx as (
  select (select auth.uid()) as uid
)
select
  f.id,
  f.user_id,
  f.calendar_id,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.is_personal as calendar_is_personal,
  f.name,
  f.color,
  f.active,
  f.is_saved,
  f.start_date,
  f.end_date,
  f.notes,
  f.rules,
  f.ai_metadata,
  f.is_hidden,
  f.share_id,
  f.created_at,
  f.updated_at,
  f.is_reminder,
  f.reminder_uuid,
  f.origin_type,
  f.origin_flow_id,
  f.origin_share_id,
  f.origin_generation_id,
  f.root_flow_id
from public.flows f
join public.shared_calendars sc
  on sc.id = f.calendar_id
join public.shared_calendar_members scm
  on scm.calendar_id = f.calendar_id
join uid_ctx u
  on scm.user_id = u.uid
where sc.deleted_at is null
  and scm.status = 'accepted';

alter view public.flows_with_calendars owner to postgres;
grant select on public.flows_with_calendars to authenticated;

comment on index public.shared_calendar_members_user_calendar_accepted_idx is
  'Supports authenticated accepted-calendar catalog reads by user.';
comment on view public.flows_with_calendars is
  'Security-invoker flow catalog scoped to the authenticated user accepted memberships.';
