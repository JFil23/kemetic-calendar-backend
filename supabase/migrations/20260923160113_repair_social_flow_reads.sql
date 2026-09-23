begin;

-- A flow owner must be able to read the flow directly. The calendar/share
-- routes are additional visibility grants, not substitutes for ownership.
drop policy if exists flows_select_visible on public.flows;

create policy flows_select_visible
on public.flows
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = flows.calendar_id
      and scm.user_id = (select auth.uid())
      and scm.status = 'accepted'
      and sc.deleted_at is null
  )
  or exists (
    select 1
    from public.flow_shares fs
    where fs.flow_id = flows.id
      and fs.deleted_at is null
      and coalesce(fs.status, 'pending')
        in ('sent', 'viewed', 'imported', 'public')
      and (
        fs.sender_id = (select auth.uid())
        or fs.recipient_id = (select auth.uid())
      )
  )
);

comment on policy flows_select_visible on public.flows is
'Canonical flow read boundary: direct owner access plus accepted-calendar and active-share visibility.';

commit;
