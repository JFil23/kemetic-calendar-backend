create or replace function public.can_view_shared_calendar_members(
  p_calendar_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and sc.deleted_at is null
  );
$$;

grant execute on function public.can_view_shared_calendar_members(uuid) to authenticated;

drop policy if exists shared_calendar_members_select_visible on public.shared_calendar_members;

create policy shared_calendar_members_select_visible
on public.shared_calendar_members
for select
using (
  user_id = auth.uid()
  or public.can_view_shared_calendar_members(calendar_id)
);

notify pgrst, 'reload schema';
