alter table public.flows
add column if not exists calendar_id uuid references public.shared_calendars(id) on delete cascade;

create or replace function public.assign_flow_calendar_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.calendar_id is null then
    new.calendar_id := public.ensure_personal_calendar_for_user(new.user_id);
  end if;
  return new;
end;
$$;

insert into public.shared_calendars (
  owner_id,
  name,
  color,
  icon,
  is_personal
)
select distinct
  au.id,
  'My Calendar',
  5099745,
  'calendar',
  true
from public.flows f
join auth.users au
  on au.id = f.user_id
where f.calendar_id is null
  and not exists (
    select 1
    from public.shared_calendars sc
    where sc.owner_id = au.id
      and sc.is_personal = true
      and sc.deleted_at is null
  );

insert into public.shared_calendar_members (
  calendar_id,
  user_id,
  role,
  status,
  invited_by,
  responded_at
)
select
  sc.id,
  sc.owner_id,
  'owner',
  'accepted',
  sc.owner_id,
  now()
from public.shared_calendars sc
where sc.deleted_at is null
  and not exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = sc.id
      and scm.user_id = sc.owner_id
  );

delete from public.flows f
where f.calendar_id is null
  and not exists (
    select 1
    from auth.users au
    where au.id = f.user_id
  );

update public.flows f
   set calendar_id = sc.id
  from public.shared_calendars sc
 where f.calendar_id is null
   and sc.owner_id = f.user_id
   and sc.is_personal = true
   and sc.deleted_at is null;

alter table public.flows
alter column calendar_id set not null;

drop trigger if exists trg_assign_flow_calendar_id on public.flows;
create trigger trg_assign_flow_calendar_id
before insert on public.flows
for each row
execute function public.assign_flow_calendar_id();

create index if not exists flows_calendar_id_updated_idx
on public.flows (calendar_id, updated_at desc);

drop view if exists public.flows_with_calendars;
create view public.flows_with_calendars
with (security_invoker = true) as
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
where sc.deleted_at is null
  and exists (
  select 1
  from public.shared_calendar_members scm
  where scm.calendar_id = f.calendar_id
    and scm.user_id = auth.uid()
    and scm.status = 'accepted'
);

grant select on public.flows_with_calendars to authenticated;

drop policy if exists "Users can delete own flows" on public.flows;
drop policy if exists "Users can delete their own flows" on public.flows;
drop policy if exists "Users can insert own flows" on public.flows;
drop policy if exists "Users can insert their own flows" on public.flows;
drop policy if exists "Users can select own flows" on public.flows;
drop policy if exists "Users can view their own flows" on public.flows;
drop policy if exists "Users can update own flows" on public.flows;
drop policy if exists "Users can update their own flows" on public.flows;
drop policy if exists flows_delete_own on public.flows;
drop policy if exists flows_insert_own on public.flows;
drop policy if exists flows_insert_owned on public.flows;
drop policy if exists flows_select on public.flows;
drop policy if exists flows_select_own on public.flows;
drop policy if exists flows_select_shared on public.flows;
drop policy if exists flows_select_visible on public.flows;
drop policy if exists flows_update_own on public.flows;
drop policy if exists flows_insert_calendar_member on public.flows;
drop policy if exists flows_update_calendar_editor on public.flows;
drop policy if exists flows_delete_calendar_editor on public.flows;

create policy flows_select_visible
on public.flows
for select
using (
  exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = flows.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and sc.deleted_at is null
  )
  or exists (
    select 1
    from public.flow_shares fs
    where fs.flow_id = flows.id
      and (fs.sender_id = auth.uid() or fs.recipient_id = auth.uid())
  )
);

create policy flows_insert_calendar_member
on public.flows
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = flows.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
      and sc.deleted_at is null
  )
);

create policy flows_update_calendar_editor
on public.flows
for update
using (
  exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = flows.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
      and sc.deleted_at is null
  )
)
with check (
  exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = flows.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
      and sc.deleted_at is null
  )
);

create policy flows_delete_calendar_editor
on public.flows
for delete
using (
  exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = flows.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
      and sc.deleted_at is null
  )
);

notify pgrst, 'reload schema';
