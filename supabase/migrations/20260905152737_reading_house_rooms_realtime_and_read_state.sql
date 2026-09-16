create schema if not exists private;

create or replace function public.reading_house_flow_on_calendar(
  p_calendar_id uuid,
  p_flow_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.flows f
    join public.shared_calendars sc
      on sc.id = f.calendar_id
    where f.id = p_flow_id
      and f.calendar_id = p_calendar_id
      and auth.uid() is not null
      and public.reading_house_is_calendar_member(
        p_calendar_id,
        (select auth.uid())
      )
      and sc.deleted_at is null
      and coalesce(sc.is_personal, false) is false
      and (
        f.ai_metadata ->> 'flow_key' = 'the-reading-house'
        or coalesce(f.notes, '') like '%maat=the-reading-house%'
      )
  );
$$;

revoke all on function public.reading_house_flow_on_calendar(uuid, bigint)
from public, anon;
grant execute on function public.reading_house_flow_on_calendar(uuid, bigint)
to authenticated, service_role;

create or replace function private.reading_house_is_active_house(
  p_calendar_id uuid,
  p_flow_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.flows f
    join public.shared_calendars sc
      on sc.id = f.calendar_id
    where f.id = p_flow_id
      and f.calendar_id = p_calendar_id
      and f.active is true
      and coalesce(f.is_hidden, false) is false
      and sc.deleted_at is null
      and coalesce(sc.is_personal, false) is false
      and (
        f.ai_metadata ->> 'flow_key' = 'the-reading-house'
        or coalesce(f.notes, '') like '%maat=the-reading-house%'
      )
  );
$$;

revoke all on function private.reading_house_is_active_house(uuid, bigint)
from public, anon, authenticated;

create table if not exists public.reading_house_room_read_state (
  calendar_id uuid not null references public.shared_calendars(id)
    on delete cascade,
  flow_id bigint not null references public.flows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (calendar_id, flow_id, user_id)
);

create index if not exists reading_house_room_read_state_user_idx
  on public.reading_house_room_read_state(user_id, updated_at desc);

drop trigger if exists trg_touch_reading_house_room_read_state_updated_at
on public.reading_house_room_read_state;
create trigger trg_touch_reading_house_room_read_state_updated_at
before update on public.reading_house_room_read_state
for each row
execute function public.touch_reading_house_shared_fragment_updated_at();

alter table public.reading_house_room_read_state enable row level security;

revoke all on table public.reading_house_room_read_state from public, anon;

drop policy if exists reading_house_room_read_state_select_own
on public.reading_house_room_read_state;
create policy reading_house_room_read_state_select_own
on public.reading_house_room_read_state
for select
to authenticated
using (
  user_id = (select auth.uid())
  and public.reading_house_is_calendar_member(
    calendar_id,
    (select auth.uid())
  )
  and public.reading_house_flow_on_calendar(calendar_id, flow_id)
);

drop policy if exists reading_house_room_read_state_insert_own
on public.reading_house_room_read_state;
drop policy if exists reading_house_room_read_state_update_own
on public.reading_house_room_read_state;

create or replace function private.guard_reading_house_room_read_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.last_read_at := least(
    coalesce(new.last_read_at, timezone('utc', now())),
    timezone('utc', now())
  );

  if tg_op = 'UPDATE'
      and (
        old.calendar_id <> new.calendar_id
        or old.flow_id <> new.flow_id
        or old.user_id <> new.user_id
      ) then
    raise exception 'HOUSE_READ_STATE_IDENTITY_IMMUTABLE';
  end if;

  if tg_op = 'UPDATE' and new.last_read_at < old.last_read_at then
    raise exception 'HOUSE_READ_STATE_CANNOT_REGRESS';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_reading_house_room_read_state()
from public, anon, authenticated;

update public.reading_house_room_read_state
set last_read_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
where last_read_at > timezone('utc', now());

drop trigger if exists trg_guard_reading_house_room_read_state
on public.reading_house_room_read_state;
create trigger trg_guard_reading_house_room_read_state
before insert or update on public.reading_house_room_read_state
for each row
execute function private.guard_reading_house_room_read_state();

create or replace function public.mark_reading_house_room_read(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_last_read_at timestamptz default timezone('utc', now())
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_last_read_at timestamptz := least(
    coalesce(p_last_read_at, timezone('utc', now())),
    timezone('utc', now())
  );
  v_saved timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_calendar_id is null or coalesce(p_flow_id, 0) <= 0 then
    raise exception 'HOUSE_REQUIRED';
  end if;

  if not public.reading_house_is_calendar_member(p_calendar_id, v_uid)
      or not public.reading_house_flow_on_calendar(p_calendar_id, p_flow_id)
      or public.reading_house_is_solo_study_house(p_calendar_id, p_flow_id) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  insert into public.reading_house_room_read_state (
    calendar_id,
    flow_id,
    user_id,
    last_read_at
  )
  values (p_calendar_id, p_flow_id, v_uid, v_last_read_at)
  on conflict (calendar_id, flow_id, user_id)
  do update
     set last_read_at = greatest(
           public.reading_house_room_read_state.last_read_at,
           excluded.last_read_at
         ),
         updated_at = timezone('utc', now())
  returning last_read_at into v_saved;

  return v_saved;
end;
$$;

revoke all on function public.mark_reading_house_room_read(
  uuid,
  bigint,
  timestamptz
) from public, anon;
grant execute on function public.mark_reading_house_room_read(
  uuid,
  bigint,
  timestamptz
) to authenticated, service_role;

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
  f.active is true as active,
  coalesce(members.member_count, 0) < 2 as locked,
  f.active is not true as ended
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
  and not public.reading_house_is_solo_study_house(sc.id, f.id)
  and (
    f.ai_metadata ->> 'flow_key' = 'the-reading-house'
    or coalesce(f.notes, '') like '%maat=the-reading-house%'
  );

revoke insert, update, delete, truncate, references, trigger
on public.reading_house_room_read_state from authenticated;
grant select on public.reading_house_room_read_state to authenticated;
grant all on table public.reading_house_room_read_state to service_role;
grant select on public.reading_house_room_summaries
to authenticated, service_role;

drop policy if exists reading_house_chat_messages_select_members
on public.reading_house_chat_messages;
create policy reading_house_chat_messages_select_members
on public.reading_house_chat_messages
for select
to authenticated
using (
  deleted_at is null
  and public.reading_house_is_calendar_member(
    calendar_id,
    (select auth.uid())
  )
  and public.reading_house_flow_on_calendar(calendar_id, flow_id)
  and not public.reading_house_is_solo_study_house(calendar_id, flow_id)
);

create or replace function public.create_reading_house_chat_message(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_active_member_count integer := 0;
  v_message_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_calendar_id is null or coalesce(p_flow_id, 0) <= 0 then
    raise exception 'HOUSE_REQUIRED';
  end if;

  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'CHAT_BODY_INVALID';
  end if;

  if not public.reading_house_is_calendar_member(p_calendar_id, v_uid)
      or not public.reading_house_flow_on_calendar(p_calendar_id, p_flow_id) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if not private.reading_house_is_active_house(p_calendar_id, p_flow_id) then
    raise exception 'HOUSE_ENDED_READ_ONLY';
  end if;

  if public.reading_house_is_solo_study_house(p_calendar_id, p_flow_id) then
    raise exception 'CHAT_NOT_AVAILABLE_FOR_SOLO_STUDY';
  end if;

  select count(*)::integer
    into v_active_member_count
  from public.shared_calendar_members member
  join public.shared_calendars calendar
    on calendar.id = member.calendar_id
  where member.calendar_id = p_calendar_id
    and member.status = 'accepted'
    and calendar.deleted_at is null
    and coalesce(calendar.is_personal, false) is false;

  if v_active_member_count < 2 then
    raise exception 'CHAT_OPENS_WHEN_READERS_JOIN';
  end if;

  insert into public.reading_house_chat_messages (
    calendar_id,
    flow_id,
    author_id,
    body
  )
  values (p_calendar_id, p_flow_id, v_uid, v_body)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

create or replace function public.delete_reading_house_chat_message(
  p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.reading_house_chat_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_message
  from public.reading_house_chat_messages
  where id = p_message_id;

  if not found or v_message.deleted_at is not null then
    return false;
  end if;

  if not public.reading_house_is_calendar_member(v_message.calendar_id, v_uid)
      or not public.reading_house_flow_on_calendar(
        v_message.calendar_id,
        v_message.flow_id
      ) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if not private.reading_house_is_active_house(
    v_message.calendar_id,
    v_message.flow_id
  ) then
    raise exception 'HOUSE_ENDED_READ_ONLY';
  end if;

  if v_message.author_id <> v_uid
      and not public.reading_house_can_moderate_calendar(
        v_message.calendar_id,
        v_uid
      ) then
    raise exception 'CHAT_MESSAGE_NOT_EDITABLE';
  end if;

  update public.reading_house_chat_messages
     set deleted_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
   where id = v_message.id;

  return true;
end;
$$;

create or replace function public.update_reading_house_chat_message(
  p_message_id uuid,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_message public.reading_house_chat_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'CHAT_BODY_INVALID';
  end if;

  select *
    into v_message
  from public.reading_house_chat_messages
  where id = p_message_id;

  if not found or v_message.deleted_at is not null then
    return false;
  end if;

  if not public.reading_house_is_calendar_member(v_message.calendar_id, v_uid)
      or not public.reading_house_flow_on_calendar(
        v_message.calendar_id,
        v_message.flow_id
      ) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if not private.reading_house_is_active_house(
    v_message.calendar_id,
    v_message.flow_id
  ) then
    raise exception 'HOUSE_ENDED_READ_ONLY';
  end if;

  if v_message.author_id <> v_uid then
    raise exception 'CHAT_MESSAGE_NOT_EDITABLE';
  end if;

  update public.reading_house_chat_messages
     set body = v_body,
         updated_at = timezone('utc', now())
   where id = v_message.id;

  return true;
end;
$$;

revoke all on function public.create_reading_house_chat_message(
  uuid,
  bigint,
  text
) from public, anon;
grant execute on function public.create_reading_house_chat_message(
  uuid,
  bigint,
  text
) to authenticated, service_role;

revoke all on function public.delete_reading_house_chat_message(uuid)
from public, anon;
grant execute on function public.delete_reading_house_chat_message(uuid)
to authenticated, service_role;

revoke all on function public.update_reading_house_chat_message(uuid, text)
from public, anon;
grant execute on function public.update_reading_house_chat_message(uuid, text)
to authenticated, service_role;

create or replace function private.guard_reading_house_live_lane_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calendar_id uuid := case when tg_op = 'DELETE'
    then old.calendar_id
    else new.calendar_id
  end;
  v_flow_id bigint := case when tg_op = 'DELETE'
    then old.flow_id
    else new.flow_id
  end;
begin
  if tg_op = 'UPDATE'
      and (old.calendar_id <> new.calendar_id or old.flow_id <> new.flow_id) then
    raise exception 'HOUSE_ROOM_IDENTITY_IMMUTABLE';
  end if;

  if not private.reading_house_is_active_house(v_calendar_id, v_flow_id) then
    raise exception 'HOUSE_ENDED_READ_ONLY';
  end if;

  if tg_table_name = 'reading_house_announcements'
      and not public.reading_house_can_moderate_calendar(
        v_calendar_id,
        auth.uid()
      ) then
    raise exception 'ANNOUNCEMENT_NOT_ALLOWED';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.guard_reading_house_live_lane_mutation()
from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'reading_house_chat_messages',
    'reading_house_shared_fragments',
    'reading_house_fragment_replies',
    'reading_house_announcements'
  ]
  loop
    execute format(
      'drop trigger if exists trg_guard_reading_house_live_lane_mutation on public.%I',
      table_name
    );
    execute format(
      'create trigger trg_guard_reading_house_live_lane_mutation '
      'before insert or update or delete on public.%I '
      'for each row execute function private.guard_reading_house_live_lane_mutation()',
      table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'reading_house_chat_messages',
    'reading_house_shared_fragments',
    'reading_house_fragment_replies',
    'reading_house_announcements'
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

notify pgrst, 'reload schema';
