create table if not exists public.reading_house_sitting_positions (
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  flow_id bigint not null references public.flows(id) on delete cascade,
  client_event_id text not null,
  event_number integer,
  user_id uuid not null references auth.users(id) on delete cascade,
  reading_position text not null
    check (reading_position in ('carrying', 'not_yet')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (calendar_id, flow_id, client_event_id, user_id)
);

create index if not exists reading_house_sitting_positions_user_idx
  on public.reading_house_sitting_positions(user_id, updated_at desc);

create table if not exists public.reading_house_shared_fragments (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  flow_id bigint not null references public.flows(id) on delete cascade,
  client_event_id text not null,
  event_number integer,
  author_id uuid not null references public.profiles(id) on delete cascade,
  passage_reference text,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists reading_house_shared_fragments_sitting_idx
  on public.reading_house_shared_fragments(
    calendar_id,
    flow_id,
    client_event_id,
    created_at desc
  )
  where deleted_at is null;

create index if not exists reading_house_shared_fragments_author_idx
  on public.reading_house_shared_fragments(author_id, created_at desc)
  where deleted_at is null;

create or replace function public.touch_reading_house_shared_fragment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_reading_house_sitting_positions_updated_at
on public.reading_house_sitting_positions;
create trigger trg_touch_reading_house_sitting_positions_updated_at
before update on public.reading_house_sitting_positions
for each row
execute function public.touch_reading_house_shared_fragment_updated_at();

drop trigger if exists trg_touch_reading_house_shared_fragments_updated_at
on public.reading_house_shared_fragments;
create trigger trg_touch_reading_house_shared_fragments_updated_at
before update on public.reading_house_shared_fragments
for each row
execute function public.touch_reading_house_shared_fragment_updated_at();

create or replace function public.reading_house_is_calendar_member(
  p_calendar_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = p_user_id
      and scm.status = 'accepted'
      and sc.deleted_at is null
      and coalesce(sc.is_personal, false) = false
  );
$$;

create or replace function public.reading_house_can_moderate_calendar(
  p_calendar_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = p_user_id
      and scm.status = 'accepted'
      and scm.role in ('owner', 'editor')
      and sc.deleted_at is null
      and coalesce(sc.is_personal, false) = false
  );
$$;

create or replace function public.reading_house_fragment_event_exists(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_client_event_id text
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
      and ue.client_event_id = p_client_event_id
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

create or replace function public.reading_house_has_fragment_unlock(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_client_event_id text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reading_house_sitting_positions rhsp
    where rhsp.calendar_id = p_calendar_id
      and rhsp.flow_id = p_flow_id
      and rhsp.client_event_id = p_client_event_id
      and rhsp.user_id = p_user_id
      and rhsp.reading_position = 'carrying'
  )
  or exists (
    select 1
    from public.user_event_completions uec
    where uec.user_id = p_user_id
      and uec.flow_id = p_flow_id
      and uec.client_event_id = p_client_event_id
      and uec.metadata ->> 'flow_key' = 'the-reading-house'
      and uec.metadata ->> 'reading_position' = 'carrying'
  );
$$;

alter table public.reading_house_sitting_positions enable row level security;
alter table public.reading_house_shared_fragments enable row level security;

drop policy if exists reading_house_sitting_positions_select_own_or_moderator
on public.reading_house_sitting_positions;
create policy reading_house_sitting_positions_select_own_or_moderator
on public.reading_house_sitting_positions
for select
using (
  user_id = auth.uid()
  or public.reading_house_can_moderate_calendar(calendar_id)
);

drop policy if exists reading_house_sitting_positions_insert_own_member
on public.reading_house_sitting_positions;
create policy reading_house_sitting_positions_insert_own_member
on public.reading_house_sitting_positions
for insert
with check (
  user_id = auth.uid()
  and public.reading_house_is_calendar_member(calendar_id)
  and public.reading_house_fragment_event_exists(
    calendar_id,
    flow_id,
    client_event_id
  )
);

drop policy if exists reading_house_sitting_positions_update_own_member
on public.reading_house_sitting_positions;
create policy reading_house_sitting_positions_update_own_member
on public.reading_house_sitting_positions
for update
using (
  user_id = auth.uid()
  and public.reading_house_is_calendar_member(calendar_id)
)
with check (
  user_id = auth.uid()
  and public.reading_house_is_calendar_member(calendar_id)
  and public.reading_house_fragment_event_exists(
    calendar_id,
    flow_id,
    client_event_id
  )
);

drop policy if exists reading_house_shared_fragments_select_members_unlocked
on public.reading_house_shared_fragments;
create policy reading_house_shared_fragments_select_members_unlocked
on public.reading_house_shared_fragments
for select
using (
  deleted_at is null
  and public.reading_house_is_calendar_member(calendar_id)
  and (
    public.reading_house_can_moderate_calendar(calendar_id)
    or public.reading_house_has_fragment_unlock(
      calendar_id,
      flow_id,
      client_event_id
    )
  )
);

drop policy if exists reading_house_shared_fragments_insert_author_unlocked
on public.reading_house_shared_fragments;
create policy reading_house_shared_fragments_insert_author_unlocked
on public.reading_house_shared_fragments
for insert
with check (
  author_id = auth.uid()
  and deleted_at is null
  and public.reading_house_is_calendar_member(calendar_id)
  and public.reading_house_fragment_event_exists(
    calendar_id,
    flow_id,
    client_event_id
  )
  and public.reading_house_has_fragment_unlock(
    calendar_id,
    flow_id,
    client_event_id
  )
);

create or replace function public.upsert_reading_house_sitting_position(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_client_event_id text,
  p_event_number integer,
  p_reading_position text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_position text := lower(coalesce(nullif(btrim(p_reading_position), ''), ''));
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

  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    raise exception 'CLIENT_EVENT_REQUIRED';
  end if;

  if v_position not in ('carrying', 'not_yet') then
    raise exception 'INVALID_READING_POSITION';
  end if;

  if not public.reading_house_is_calendar_member(p_calendar_id, v_uid) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if not public.reading_house_fragment_event_exists(
    p_calendar_id,
    p_flow_id,
    p_client_event_id
  ) then
    raise exception 'SITTING_NOT_FOUND';
  end if;

  insert into public.reading_house_sitting_positions (
    calendar_id,
    flow_id,
    client_event_id,
    event_number,
    user_id,
    reading_position
  )
  values (
    p_calendar_id,
    p_flow_id,
    btrim(p_client_event_id),
    p_event_number,
    v_uid,
    v_position
  )
  on conflict (calendar_id, flow_id, client_event_id, user_id)
  do update
    set event_number = excluded.event_number,
        reading_position = excluded.reading_position,
        updated_at = now();
end;
$$;

revoke all on function public.upsert_reading_house_sitting_position(
  uuid,
  bigint,
  text,
  integer,
  text
) from public;
grant execute on function public.upsert_reading_house_sitting_position(
  uuid,
  bigint,
  text,
  integer,
  text
) to authenticated;

create or replace function public.delete_reading_house_shared_fragment(
  p_fragment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fragment public.reading_house_shared_fragments%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_fragment
  from public.reading_house_shared_fragments
  where id = p_fragment_id;

  if not found or v_fragment.deleted_at is not null then
    return false;
  end if;

  if not public.reading_house_is_calendar_member(v_fragment.calendar_id, v_uid) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if v_fragment.author_id <> v_uid
      and not public.reading_house_can_moderate_calendar(
        v_fragment.calendar_id,
        v_uid
      ) then
    raise exception 'FRAGMENT_NOT_EDITABLE';
  end if;

  update public.reading_house_shared_fragments
     set deleted_at = now(),
         updated_at = now()
   where id = v_fragment.id;

  return true;
end;
$$;

revoke all on function public.delete_reading_house_shared_fragment(uuid)
from public;
grant execute on function public.delete_reading_house_shared_fragment(uuid)
to authenticated;

grant execute on function public.reading_house_can_moderate_calendar(uuid, uuid)
to authenticated;
grant select, insert on public.reading_house_shared_fragments to authenticated;
grant select, insert, update on public.reading_house_sitting_positions to authenticated;

notify pgrst, 'reload schema';
