create table if not exists public.shared_calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color bigint not null default 5099745,
  icon text not null default 'calendar',
  is_personal boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);

create table if not exists public.shared_calendar_members (
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor',
  status text not null default 'pending',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  responded_at timestamp with time zone,
  primary key (calendar_id, user_id),
  constraint shared_calendar_members_role_check check (
    role = any (array['owner'::text, 'editor'::text, 'viewer'::text])
  ),
  constraint shared_calendar_members_status_check check (
    status = any (array['pending'::text, 'accepted'::text, 'declined'::text])
  )
);

create unique index if not exists shared_calendars_owner_personal_unique
on public.shared_calendars (owner_id)
where is_personal = true and deleted_at is null;

create index if not exists shared_calendar_members_user_status_idx
on public.shared_calendar_members (user_id, status, updated_at desc);

create index if not exists shared_calendar_members_calendar_status_idx
on public.shared_calendar_members (calendar_id, status, updated_at desc);

create or replace function public.touch_shared_calendars_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_shared_calendar_members_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_shared_calendars_updated_at on public.shared_calendars;
create trigger trg_touch_shared_calendars_updated_at
before update on public.shared_calendars
for each row
execute function public.touch_shared_calendars_updated_at();

drop trigger if exists trg_touch_shared_calendar_members_updated_at on public.shared_calendar_members;
create trigger trg_touch_shared_calendar_members_updated_at
before update on public.shared_calendar_members
for each row
execute function public.touch_shared_calendar_members_updated_at();

create or replace function public.ensure_personal_calendar_for_user(
  p_user_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := p_user_id;
  v_calendar_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select sc.id
    into v_calendar_id
  from public.shared_calendars sc
  where sc.owner_id = v_user_id
    and sc.is_personal = true
    and sc.deleted_at is null
  limit 1;

  if v_calendar_id is null then
    insert into public.shared_calendars (
      owner_id,
      name,
      color,
      icon,
      is_personal
    )
    values (
      v_user_id,
      'My Calendar',
      5099745,
      'calendar',
      true
    )
    returning id into v_calendar_id;
  end if;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at
  )
  values (
    v_calendar_id,
    v_user_id,
    'owner',
    'accepted',
    v_user_id,
    now()
  )
  on conflict (calendar_id, user_id)
  do update
    set role = 'owner',
        status = 'accepted',
        invited_by = excluded.invited_by,
        responded_at = coalesce(
          public.shared_calendar_members.responded_at,
          excluded.responded_at
        ),
        updated_at = now();

  return v_calendar_id;
end;
$$;

grant execute on function public.ensure_personal_calendar_for_user(uuid) to authenticated;

create or replace function public.create_shared_calendar(
  p_name text,
  p_color bigint default 5099745
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_calendar_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_name is null then
    raise exception 'CALENDAR_NAME_REQUIRED';
  end if;

  insert into public.shared_calendars (
    owner_id,
    name,
    color,
    icon,
    is_personal
  )
  values (
    v_user_id,
    v_name,
    coalesce(p_color, 5099745),
    'calendar',
    false
  )
  returning id into v_calendar_id;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at
  )
  values (
    v_calendar_id,
    v_user_id,
    'owner',
    'accepted',
    v_user_id,
    now()
  )
  on conflict (calendar_id, user_id)
  do nothing;

  return v_calendar_id;
end;
$$;

grant execute on function public.create_shared_calendar(text, bigint) to authenticated;

create or replace function public.update_shared_calendar(
  p_calendar_id uuid,
  p_name text,
  p_color bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_name is null then
    raise exception 'CALENDAR_NAME_REQUIRED';
  end if;

  update public.shared_calendars sc
     set name = v_name,
         color = coalesce(p_color, sc.color),
         updated_at = now()
   where sc.id = p_calendar_id
     and sc.owner_id = v_user_id
     and sc.deleted_at is null;

  if not found then
    raise exception 'CALENDAR_NOT_EDITABLE';
  end if;
end;
$$;

grant execute on function public.update_shared_calendar(uuid, text, bigint) to authenticated;

create or replace function public.invite_user_to_shared_calendar(
  p_calendar_id uuid,
  p_user_id uuid,
  p_role text default 'editor'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role text := coalesce(nullif(btrim(p_role), ''), 'editor');
  v_existing_status text;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'INVITEE_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_INVITE_SELF';
  end if;

  if v_role not in ('editor', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_INVITABLE';
  end if;

  select scm.status
    into v_existing_status
  from public.shared_calendar_members scm
  where scm.calendar_id = p_calendar_id
    and scm.user_id = p_user_id;

  if v_existing_status = 'accepted' then
    return;
  end if;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at
  )
  values (
    p_calendar_id,
    p_user_id,
    v_role,
    'pending',
    v_actor_id,
    null
  )
  on conflict (calendar_id, user_id)
  do update
    set role = excluded.role,
        status = 'pending',
        invited_by = excluded.invited_by,
        responded_at = null,
        updated_at = now();
end;
$$;

grant execute on function public.invite_user_to_shared_calendar(uuid, uuid, text) to authenticated;

create or replace function public.respond_to_shared_calendar_invite(
  p_calendar_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_calendar_members scm
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now(),
         updated_at = now()
   where scm.calendar_id = p_calendar_id
     and scm.user_id = v_user_id
     and scm.status = 'pending';

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;
end;
$$;

grant execute on function public.respond_to_shared_calendar_invite(uuid, boolean) to authenticated;

create or replace function public.leave_shared_calendar(
  p_calendar_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_is_personal boolean;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select sc.owner_id, sc.is_personal
    into v_owner_id, v_is_personal
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  if v_owner_id is null then
    raise exception 'CALENDAR_NOT_FOUND';
  end if;

  if v_owner_id = v_user_id then
    if v_is_personal then
      raise exception 'CANNOT_DELETE_PERSONAL_CALENDAR';
    end if;

    delete from public.shared_calendars
    where id = p_calendar_id
      and owner_id = v_user_id;
    return;
  end if;

  delete from public.shared_calendar_members scm
  where scm.calendar_id = p_calendar_id
    and scm.user_id = v_user_id;
end;
$$;

grant execute on function public.leave_shared_calendar(uuid) to authenticated;

create or replace function public.assign_user_event_calendar_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  if new.calendar_id is null then
    new.calendar_id := public.ensure_personal_calendar_for_user(new.user_id);
  end if;

  return new;
end;
$$;

alter table public.user_events
add column if not exists calendar_id uuid references public.shared_calendars(id) on delete cascade;

insert into public.shared_calendars (
  owner_id,
  name,
  color,
  icon,
  is_personal
)
select
  au.id,
  'My Calendar',
  5099745,
  'calendar',
  true
from auth.users au
where au.id is not null
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

update public.user_events ue
   set calendar_id = sc.id
  from public.shared_calendars sc
 where ue.calendar_id is null
   and sc.owner_id = ue.user_id
   and sc.is_personal = true
   and sc.deleted_at is null;

alter table public.user_events
alter column calendar_id set not null;

drop trigger if exists trg_assign_user_event_calendar_id on public.user_events;
create trigger trg_assign_user_event_calendar_id
before insert on public.user_events
for each row
execute function public.assign_user_event_calendar_id();

create index if not exists user_events_calendar_id_starts_at_idx
on public.user_events (calendar_id, starts_at);

create or replace view public.shared_calendar_summaries as
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

create or replace view public.shared_calendar_pending_invites as
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

create or replace view public.user_events_with_calendars as
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

alter table public.shared_calendars enable row level security;
alter table public.shared_calendar_members enable row level security;

create policy shared_calendars_select_member
on public.shared_calendars
for select
using (
  deleted_at is null
  and exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = shared_calendars.id
      and scm.user_id = auth.uid()
      and scm.status in ('pending', 'accepted')
  )
);

create policy shared_calendar_members_select_visible
on public.shared_calendar_members
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.shared_calendar_members self_member
    where self_member.calendar_id = shared_calendar_members.calendar_id
      and self_member.user_id = auth.uid()
      and self_member.status = 'accepted'
  )
);

create policy user_events_select_shared_calendars
on public.user_events
for select
using (
  exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = user_events.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
  )
);

create policy user_events_insert_shared_calendars
on public.user_events
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = user_events.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
  )
);

create policy user_events_update_shared_calendars
on public.user_events
for update
using (
  exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = user_events.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
  )
)
with check (
  exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = user_events.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
  )
);

create policy user_events_delete_shared_calendars
on public.user_events
for delete
using (
  exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = user_events.calendar_id
      and scm.user_id = auth.uid()
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
  )
);
