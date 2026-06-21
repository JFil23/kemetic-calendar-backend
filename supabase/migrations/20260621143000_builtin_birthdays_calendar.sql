alter table public.shared_calendars
  add column if not exists system_type text;

do $$
begin
  alter table public.shared_calendars
    add constraint shared_calendars_system_type_check
    check (system_type is null or system_type in ('birthdays'));
exception
  when duplicate_object then null;
end;
$$;

with ranked_existing_birthdays as (
  select
    sc.id,
    row_number() over (
      partition by sc.owner_id
      order by sc.created_at asc, sc.id asc
    ) as rn
  from public.shared_calendars sc
  where sc.deleted_at is null
    and (
      sc.system_type = 'birthdays'
      or lower(btrim(sc.name)) = 'birthdays'
      or lower(btrim(sc.icon)) = 'birthdays'
    )
)
update public.shared_calendars sc
   set system_type = case when reb.rn = 1 then 'birthdays' else null end,
       name = case when reb.rn = 1 then 'Birthdays' else sc.name end,
       color = case when reb.rn = 1 then 4280407733 else sc.color end,
       icon = case when reb.rn = 1 then 'birthdays' else sc.icon end,
       is_personal = case when reb.rn = 1 then false else sc.is_personal end,
       updated_at = now()
  from ranked_existing_birthdays reb
 where sc.id = reb.id;

create unique index if not exists shared_calendars_owner_system_type_unique
on public.shared_calendars (owner_id, system_type)
where system_type is not null and deleted_at is null;

insert into public.shared_calendars (
  owner_id,
  name,
  color,
  icon,
  is_personal,
  system_type
)
select
  u.id,
  'Birthdays',
  4280407733,
  'birthdays',
  false,
  'birthdays'
from auth.users u
where not exists (
  select 1
  from public.shared_calendars sc
  where sc.owner_id = u.id
    and sc.system_type = 'birthdays'
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
where sc.system_type = 'birthdays'
  and sc.deleted_at is null
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

create table if not exists public.birthday_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  name text not null,
  month integer not null,
  day integer not null,
  birth_year integer,
  alert_offset_minutes integer not null default -1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  constraint birthday_items_name_present_check check (btrim(name) <> ''),
  constraint birthday_items_birth_year_check check (
    birth_year is null or birth_year between 1 and 9999
  ),
  constraint birthday_items_month_day_check check (
    month between 1 and 12
    and case
      when month = 2 then day between 1 and 29
      when month in (4, 6, 9, 11) then day between 1 and 30
      else day between 1 and 31
    end
  )
);

create index if not exists birthday_items_user_calendar_idx
on public.birthday_items (user_id, calendar_id, month, day)
where deleted_at is null;

create or replace function public.touch_birthday_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_birthday_items_updated_at on public.birthday_items;
create trigger trg_touch_birthday_items_updated_at
before update on public.birthday_items
for each row
execute function public.touch_birthday_items_updated_at();

alter table public.birthday_items enable row level security;

drop policy if exists birthday_items_select_own on public.birthday_items;
create policy birthday_items_select_own
on public.birthday_items
for select
using (user_id = auth.uid());

drop policy if exists birthday_items_insert_own_birthdays_calendar on public.birthday_items;
create policy birthday_items_insert_own_birthdays_calendar
on public.birthday_items
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.shared_calendars sc
    where sc.id = birthday_items.calendar_id
      and sc.owner_id = auth.uid()
      and sc.system_type = 'birthdays'
      and sc.deleted_at is null
  )
);

drop policy if exists birthday_items_update_own on public.birthday_items;
create policy birthday_items_update_own
on public.birthday_items
for update
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.shared_calendars sc
    where sc.id = birthday_items.calendar_id
      and sc.owner_id = auth.uid()
      and sc.system_type = 'birthdays'
      and sc.deleted_at is null
  )
);

drop policy if exists birthday_items_delete_own on public.birthday_items;
create policy birthday_items_delete_own
on public.birthday_items
for delete
using (user_id = auth.uid());

create or replace function public.ensure_birthdays_calendar_for_user(
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

  if v_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;

  select sc.id
    into v_calendar_id
  from public.shared_calendars sc
  where sc.owner_id = v_user_id
    and sc.system_type = 'birthdays'
    and sc.deleted_at is null
  order by sc.created_at asc, sc.id asc
  limit 1;

  if v_calendar_id is null then
    insert into public.shared_calendars (
      owner_id,
      name,
      color,
      icon,
      is_personal,
      system_type
    )
    values (
      v_user_id,
      'Birthdays',
      4280407733,
      'birthdays',
      false,
      'birthdays'
    )
    returning id into v_calendar_id;
  else
    update public.shared_calendars
       set name = 'Birthdays',
           color = 4280407733,
           icon = 'birthdays',
           is_personal = false,
           updated_at = now()
     where id = v_calendar_id;
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

revoke all on function public.ensure_birthdays_calendar_for_user(uuid)
from public;
revoke all on function public.ensure_birthdays_calendar_for_user(uuid)
from anon;
grant execute on function public.ensure_birthdays_calendar_for_user(uuid)
to authenticated;

create or replace function public.create_birthday_item(
  p_name text,
  p_month integer,
  p_day integer,
  p_birth_year integer default null,
  p_alert_offset_minutes integer default -1
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
  v_birthday_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_name is null then
    raise exception 'BIRTHDAY_NAME_REQUIRED';
  end if;

  if p_month is null or p_day is null then
    raise exception 'BIRTHDAY_DATE_REQUIRED';
  end if;

  if p_month < 1 or p_month > 12 then
    raise exception 'BIRTHDAY_MONTH_INVALID';
  end if;

  if not (
    (p_month = 2 and p_day between 1 and 29)
    or (p_month in (4, 6, 9, 11) and p_day between 1 and 30)
    or (p_month not in (2, 4, 6, 9, 11) and p_day between 1 and 31)
  ) then
    raise exception 'BIRTHDAY_DAY_INVALID';
  end if;

  if p_birth_year is not null and (p_birth_year < 1 or p_birth_year > 9999) then
    raise exception 'BIRTHDAY_YEAR_INVALID';
  end if;

  v_calendar_id := public.ensure_birthdays_calendar_for_user(v_user_id);

  insert into public.birthday_items (
    user_id,
    calendar_id,
    name,
    month,
    day,
    birth_year,
    alert_offset_minutes
  )
  values (
    v_user_id,
    v_calendar_id,
    v_name,
    p_month,
    p_day,
    p_birth_year,
    coalesce(p_alert_offset_minutes, -1)
  )
  returning id into v_birthday_id;

  return v_birthday_id;
end;
$$;

revoke all on function public.create_birthday_item(
  text,
  integer,
  integer,
  integer,
  integer
) from public;
revoke all on function public.create_birthday_item(
  text,
  integer,
  integer,
  integer,
  integer
) from anon;
grant execute on function public.create_birthday_item(
  text,
  integer,
  integer,
  integer,
  integer
) to authenticated;

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

  if v_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
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

  perform public.ensure_birthdays_calendar_for_user(v_user_id);

  return v_calendar_id;
end;
$$;

revoke all on function public.ensure_personal_calendar_for_user(uuid)
from public;
revoke all on function public.ensure_personal_calendar_for_user(uuid)
from anon;
grant execute on function public.ensure_personal_calendar_for_user(uuid)
to authenticated;

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
     and sc.system_type is null
     and sc.deleted_at is null;

  if not found then
    raise exception 'CALENDAR_NOT_EDITABLE';
  end if;
end;
$$;

grant execute on function public.update_shared_calendar(uuid, text, bigint)
to authenticated;

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
  v_system_type text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select sc.owner_id, sc.is_personal, sc.system_type
    into v_owner_id, v_is_personal, v_system_type
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  if v_owner_id is null then
    raise exception 'CALENDAR_NOT_FOUND';
  end if;

  if v_system_type is not null then
    raise exception 'CANNOT_DELETE_SYSTEM_CALENDAR';
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

create or replace view public.shared_calendar_filing_items_client
with (security_invoker = true)
as
with calendar_event_counts as (
  select
    e.calendar_id,
    count(*) as total_event_count,
    count(*) filter (where e.live_on_calendar) as live_event_count,
    count(*) filter (where e.lifecycle = 'inactive') as inactive_event_count,
    count(distinct e.filed_flow_id) filter (
      where e.filed_flow_id is not null and e.live_on_calendar
    ) as live_flow_count
  from public.user_event_filing_items_client e
  where e.calendar_id is not null
  group by e.calendar_id
)
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
    select count(*)::integer
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'accepted'
  ) as member_count,
  case
    when sc.owner_id = auth.uid() then (
      select count(*)::integer
      from public.shared_calendar_members inner_scm
      where inner_scm.calendar_id = sc.id
        and inner_scm.status = 'pending'
    )
    else 0
  end as pending_invite_count,
  coalesce(cec.total_event_count, 0::bigint) as total_event_count,
  coalesce(cec.live_event_count, 0::bigint) as live_event_count,
  coalesce(cec.inactive_event_count, 0::bigint) as inactive_event_count,
  coalesce(cec.live_flow_count, 0::bigint) as live_flow_count,
  'shared_calendar'::text as item_kind,
  case
    when sc.deleted_at is not null then 'deleted'::text
    when scm.status = 'accepted' then 'active'::text
    else scm.status
  end as lifecycle,
  (scm.status = 'accepted' and sc.deleted_at is null) as live_on_calendar,
  (sc.is_personal = false) as is_shared,
  jsonb_build_object(
    'item_kind', 'shared_calendar',
    'system_type', sc.system_type,
    'lifecycle', case
      when sc.deleted_at is not null then 'deleted'::text
      when scm.status = 'accepted' then 'active'::text
      else scm.status
    end,
    'membership', jsonb_build_object(
      'role', scm.role,
      'status', scm.status,
      'member_user_id', scm.user_id,
      'owner_id', sc.owner_id
    ),
    'event_counts', jsonb_build_object(
      'total', coalesce(cec.total_event_count, 0::bigint),
      'live', coalesce(cec.live_event_count, 0::bigint),
      'inactive', coalesce(cec.inactive_event_count, 0::bigint),
      'live_flows', coalesce(cec.live_flow_count, 0::bigint)
    )
  ) as filing_reasons,
  sc.system_type
from public.shared_calendars sc
join public.shared_calendar_members scm
  on scm.calendar_id = sc.id
left join public.profiles owner_profile
  on owner_profile.id = sc.owner_id
left join calendar_event_counts cec
  on cec.calendar_id = sc.id
where sc.deleted_at is null
  and scm.user_id = auth.uid()
  and scm.status = 'accepted';

revoke all on public.shared_calendar_filing_items_client from public;
revoke all on public.shared_calendar_filing_items_client from anon;
revoke all on public.shared_calendar_filing_items_client from authenticated;
grant select on public.shared_calendar_filing_items_client to authenticated;
grant select on public.shared_calendar_filing_items_client to service_role;

comment on view public.shared_calendar_filing_items_client is
'Client-safe filing view for accepted calendars. Pending invite counts are owner-only; event counts are derived from user_event_filing_items_client.';

grant all on table public.birthday_items to service_role;
grant select, insert, update, delete on table public.birthday_items to authenticated;
