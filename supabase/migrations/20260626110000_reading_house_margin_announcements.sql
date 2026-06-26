create table if not exists public.reading_house_margin_items (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars(id)
    on delete cascade,
  flow_id bigint not null references public.flows(id) on delete cascade,
  client_event_id text,
  event_number integer,
  author_id uuid not null references public.profiles(id) on delete cascade,
  passage_reference text,
  body text not null check (btrim(body) <> ''),
  spoiler boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists reading_house_margin_items_house_idx
  on public.reading_house_margin_items(
    calendar_id,
    flow_id,
    created_at asc
  )
  where deleted_at is null;

create index if not exists reading_house_margin_items_sitting_idx
  on public.reading_house_margin_items(
    calendar_id,
    flow_id,
    client_event_id,
    created_at asc
  )
  where deleted_at is null;

create index if not exists reading_house_margin_items_author_idx
  on public.reading_house_margin_items(author_id, created_at desc)
  where deleted_at is null;

create table if not exists public.reading_house_announcements (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars(id)
    on delete cascade,
  flow_id bigint not null references public.flows(id) on delete cascade,
  client_event_id text,
  event_number integer,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (btrim(body) <> ''),
  announcement_type text not null default 'note'
    check (announcement_type in ('schedule', 'pace', 'recap', 'note')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists reading_house_announcements_house_idx
  on public.reading_house_announcements(
    calendar_id,
    flow_id,
    created_at desc
  )
  where deleted_at is null;

create index if not exists reading_house_announcements_sitting_idx
  on public.reading_house_announcements(
    calendar_id,
    flow_id,
    client_event_id,
    created_at desc
  )
  where deleted_at is null;

create index if not exists reading_house_announcements_author_idx
  on public.reading_house_announcements(author_id, created_at desc)
  where deleted_at is null;

drop trigger if exists trg_touch_reading_house_margin_items_updated_at
on public.reading_house_margin_items;
create trigger trg_touch_reading_house_margin_items_updated_at
before update on public.reading_house_margin_items
for each row
execute function public.touch_reading_house_shared_fragment_updated_at();

drop trigger if exists trg_touch_reading_house_announcements_updated_at
on public.reading_house_announcements;
create trigger trg_touch_reading_house_announcements_updated_at
before update on public.reading_house_announcements
for each row
execute function public.touch_reading_house_shared_fragment_updated_at();

create or replace function public.reading_house_flow_on_calendar(
  p_calendar_id uuid,
  p_flow_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = p_flow_id
    where ue.calendar_id = p_calendar_id
      and coalesce(ue.category, '') <> 'tombstone'
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
      and (
        ue.behavior_payload ->> 'flow_key' = 'the-reading-house'
        or f.ai_metadata ->> 'flow_key' = 'the-reading-house'
        or coalesce(f.notes, '') like '%maat=the-reading-house%'
      )
  );
$$;

alter table public.reading_house_margin_items enable row level security;
alter table public.reading_house_announcements enable row level security;

drop policy if exists reading_house_margin_items_select_members
on public.reading_house_margin_items;
create policy reading_house_margin_items_select_members
on public.reading_house_margin_items
for select
using (
  deleted_at is null
  and public.reading_house_is_calendar_member(calendar_id)
);

drop policy if exists reading_house_announcements_select_members
on public.reading_house_announcements;
create policy reading_house_announcements_select_members
on public.reading_house_announcements
for select
using (
  deleted_at is null
  and public.reading_house_is_calendar_member(calendar_id)
);

create or replace function public.create_reading_house_margin_item(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_client_event_id text default null,
  p_event_number integer default null,
  p_body text default null,
  p_passage_reference text default null,
  p_spoiler boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client_event_id text := nullif(btrim(coalesce(p_client_event_id, '')), '');
  v_body text := btrim(coalesce(p_body, ''));
  v_reference text := nullif(btrim(coalesce(p_passage_reference, '')), '');
  v_margin_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_calendar_id is null then
    raise exception 'CALENDAR_REQUIRED';
  end if;

  if coalesce(p_flow_id, 0) <= 0 then
    raise exception 'FLOW_REQUIRED';
  end if;

  if v_body = '' then
    raise exception 'MARGIN_BODY_REQUIRED';
  end if;

  if not public.reading_house_is_calendar_member(p_calendar_id, v_uid) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if v_client_event_id is not null then
    if not public.reading_house_fragment_event_exists(
      p_calendar_id,
      p_flow_id,
      v_client_event_id
    ) then
      raise exception 'SITTING_NOT_FOUND';
    end if;
  elsif not public.reading_house_flow_on_calendar(p_calendar_id, p_flow_id) then
    raise exception 'HOUSE_NOT_FOUND';
  end if;

  insert into public.reading_house_margin_items (
    calendar_id,
    flow_id,
    client_event_id,
    event_number,
    author_id,
    passage_reference,
    body,
    spoiler
  )
  values (
    p_calendar_id,
    p_flow_id,
    v_client_event_id,
    p_event_number,
    v_uid,
    v_reference,
    v_body,
    coalesce(p_spoiler, false)
  )
  returning id into v_margin_id;

  return v_margin_id;
end;
$$;

create or replace function public.delete_reading_house_margin_item(
  p_margin_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_margin public.reading_house_margin_items%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_margin
  from public.reading_house_margin_items
  where id = p_margin_id;

  if not found or v_margin.deleted_at is not null then
    return false;
  end if;

  if not public.reading_house_is_calendar_member(v_margin.calendar_id, v_uid) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if v_margin.author_id <> v_uid
      and not public.reading_house_can_moderate_calendar(
        v_margin.calendar_id,
        v_uid
      ) then
    raise exception 'MARGIN_NOT_EDITABLE';
  end if;

  update public.reading_house_margin_items
     set deleted_at = now(),
         updated_at = now()
   where id = v_margin.id;

  return true;
end;
$$;

create or replace function public.create_reading_house_announcement(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_client_event_id text default null,
  p_event_number integer default null,
  p_body text default null,
  p_announcement_type text default 'note'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client_event_id text := nullif(btrim(coalesce(p_client_event_id, '')), '');
  v_body text := btrim(coalesce(p_body, ''));
  v_type text := lower(nullif(btrim(coalesce(p_announcement_type, '')), ''));
  v_announcement_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_calendar_id is null then
    raise exception 'CALENDAR_REQUIRED';
  end if;

  if coalesce(p_flow_id, 0) <= 0 then
    raise exception 'FLOW_REQUIRED';
  end if;

  if v_body = '' then
    raise exception 'ANNOUNCEMENT_BODY_REQUIRED';
  end if;

  if v_type is null then
    v_type := 'note';
  end if;

  if v_type not in ('schedule', 'pace', 'recap', 'note') then
    raise exception 'ANNOUNCEMENT_TYPE_INVALID';
  end if;

  if not public.reading_house_can_moderate_calendar(p_calendar_id, v_uid) then
    raise exception 'ANNOUNCEMENT_NOT_ALLOWED';
  end if;

  if v_client_event_id is not null then
    if not public.reading_house_fragment_event_exists(
      p_calendar_id,
      p_flow_id,
      v_client_event_id
    ) then
      raise exception 'SITTING_NOT_FOUND';
    end if;
  elsif not public.reading_house_flow_on_calendar(p_calendar_id, p_flow_id) then
    raise exception 'HOUSE_NOT_FOUND';
  end if;

  insert into public.reading_house_announcements (
    calendar_id,
    flow_id,
    client_event_id,
    event_number,
    author_id,
    body,
    announcement_type
  )
  values (
    p_calendar_id,
    p_flow_id,
    v_client_event_id,
    p_event_number,
    v_uid,
    v_body,
    v_type
  )
  returning id into v_announcement_id;

  return v_announcement_id;
end;
$$;

create or replace function public.delete_reading_house_announcement(
  p_announcement_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_announcement public.reading_house_announcements%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_announcement
  from public.reading_house_announcements
  where id = p_announcement_id;

  if not found or v_announcement.deleted_at is not null then
    return false;
  end if;

  if not public.reading_house_is_calendar_member(
    v_announcement.calendar_id,
    v_uid
  ) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if v_announcement.author_id <> v_uid
      and not public.reading_house_can_moderate_calendar(
        v_announcement.calendar_id,
        v_uid
      ) then
    raise exception 'ANNOUNCEMENT_NOT_EDITABLE';
  end if;

  update public.reading_house_announcements
     set deleted_at = now(),
         updated_at = now()
   where id = v_announcement.id;

  return true;
end;
$$;

revoke all on function public.create_reading_house_margin_item(
  uuid,
  bigint,
  text,
  integer,
  text,
  text,
  boolean
) from public;
grant execute on function public.create_reading_house_margin_item(
  uuid,
  bigint,
  text,
  integer,
  text,
  text,
  boolean
) to authenticated;

revoke all on function public.delete_reading_house_margin_item(uuid)
from public;
grant execute on function public.delete_reading_house_margin_item(uuid)
to authenticated;

revoke all on function public.create_reading_house_announcement(
  uuid,
  bigint,
  text,
  integer,
  text,
  text
) from public;
grant execute on function public.create_reading_house_announcement(
  uuid,
  bigint,
  text,
  integer,
  text,
  text
) to authenticated;

revoke all on function public.delete_reading_house_announcement(uuid)
from public;
grant execute on function public.delete_reading_house_announcement(uuid)
to authenticated;

grant select on public.reading_house_margin_items to authenticated;
grant select on public.reading_house_announcements to authenticated;

notify pgrst, 'reload schema';
