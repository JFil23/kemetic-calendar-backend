create table if not exists public.shared_practice_rooms (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  source_flow_id bigint not null,
  shared_flow_id bigint references public.flows(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  flow_key text,
  start_date date,
  end_date date,
  status text not null default 'active'
    check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_practice_rooms_calendar_idx
  on public.shared_practice_rooms(calendar_id);

create index if not exists shared_practice_rooms_source_flow_idx
  on public.shared_practice_rooms(source_flow_id);

create index if not exists shared_practice_rooms_shared_flow_idx
  on public.shared_practice_rooms(shared_flow_id);

create unique index if not exists shared_practice_rooms_active_calendar_source_start_idx
  on public.shared_practice_rooms (
    calendar_id,
    source_flow_id,
    coalesce(start_date, date '0001-01-01')
  )
  where status = 'active';

create table if not exists public.shared_practice_entries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_practice_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text,
  flow_id bigint,
  completed_on date not null,
  completion_status text not null
    check (completion_status in ('observed', 'partial', 'skipped')),
  body_text text,
  visibility text not null default 'private'
    check (visibility in ('private', 'shared_with_calendar')),
  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden', 'pending_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, user_id, completed_on, client_event_id)
);

create index if not exists shared_practice_entries_room_day_idx
  on public.shared_practice_entries(room_id, completed_on, created_at desc);

create index if not exists shared_practice_entries_user_idx
  on public.shared_practice_entries(user_id, updated_at desc);

create table if not exists public.shared_practice_presence (
  room_id uuid not null references public.shared_practice_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  opened_on date not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, client_event_id, opened_on)
);

create index if not exists shared_practice_presence_room_day_idx
  on public.shared_practice_presence(room_id, opened_on);

create or replace function public.touch_shared_practice_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_shared_practice_rooms_updated_at
on public.shared_practice_rooms;
create trigger trg_touch_shared_practice_rooms_updated_at
before update on public.shared_practice_rooms
for each row
execute function public.touch_shared_practice_updated_at();

drop trigger if exists trg_touch_shared_practice_entries_updated_at
on public.shared_practice_entries;
create trigger trg_touch_shared_practice_entries_updated_at
before update on public.shared_practice_entries
for each row
execute function public.touch_shared_practice_updated_at();

create or replace function public.shared_practice_is_calendar_member(
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
  );
$$;

create or replace function public.shared_practice_can_edit_calendar(
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
      and sc.is_personal = false
  );
$$;

create or replace function public.shared_practice_room_calendar_id(
  p_room_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select calendar_id
  from public.shared_practice_rooms
  where id = p_room_id
  limit 1;
$$;

alter table public.shared_practice_rooms enable row level security;
alter table public.shared_practice_entries enable row level security;
alter table public.shared_practice_presence enable row level security;

drop policy if exists shared_practice_rooms_select_members
on public.shared_practice_rooms;
create policy shared_practice_rooms_select_members
on public.shared_practice_rooms
for select
using (public.shared_practice_is_calendar_member(calendar_id));

drop policy if exists shared_practice_rooms_insert_editors
on public.shared_practice_rooms;
create policy shared_practice_rooms_insert_editors
on public.shared_practice_rooms
for insert
with check (
  created_by = auth.uid()
  and public.shared_practice_can_edit_calendar(calendar_id)
);

drop policy if exists shared_practice_rooms_update_creator_or_owner
on public.shared_practice_rooms;
create policy shared_practice_rooms_update_creator_or_owner
on public.shared_practice_rooms
for update
using (
  created_by = auth.uid()
  or public.shared_practice_can_edit_calendar(calendar_id)
)
with check (
  created_by = auth.uid()
  or public.shared_practice_can_edit_calendar(calendar_id)
);

drop policy if exists shared_practice_entries_select_visible
on public.shared_practice_entries;
create policy shared_practice_entries_select_visible
on public.shared_practice_entries
for select
using (
  user_id = auth.uid()
  or (
    visibility = 'shared_with_calendar'
    and moderation_status = 'visible'
    and public.shared_practice_is_calendar_member(
      public.shared_practice_room_calendar_id(room_id)
    )
  )
);

drop policy if exists shared_practice_entries_insert_own
on public.shared_practice_entries;
create policy shared_practice_entries_insert_own
on public.shared_practice_entries
for insert
with check (
  user_id = auth.uid()
  and public.shared_practice_is_calendar_member(
    public.shared_practice_room_calendar_id(room_id)
  )
);

drop policy if exists shared_practice_entries_update_own
on public.shared_practice_entries;
create policy shared_practice_entries_update_own
on public.shared_practice_entries
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists shared_practice_entries_delete_own
on public.shared_practice_entries;
create policy shared_practice_entries_delete_own
on public.shared_practice_entries
for delete
using (user_id = auth.uid());

drop policy if exists shared_practice_presence_select_members
on public.shared_practice_presence;
create policy shared_practice_presence_select_members
on public.shared_practice_presence
for select
using (
  user_id = auth.uid()
  or public.shared_practice_is_calendar_member(
    public.shared_practice_room_calendar_id(room_id)
  )
);

drop policy if exists shared_practice_presence_insert_own
on public.shared_practice_presence;
create policy shared_practice_presence_insert_own
on public.shared_practice_presence
for insert
with check (
  user_id = auth.uid()
  and public.shared_practice_is_calendar_member(
    public.shared_practice_room_calendar_id(room_id)
  )
);

create or replace function public.user_event_completions_validate_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = new.flow_id
    where ue.client_event_id = new.client_event_id
      and public.user_event_matches_flow(
        new.flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
      and (
        ue.user_id = new.user_id
        or exists (
          select 1
          from public.shared_calendar_members scm
          join public.shared_calendars sc
            on sc.id = scm.calendar_id
          where scm.calendar_id = ue.calendar_id
            and scm.user_id = new.user_id
            and scm.status = 'accepted'
            and sc.deleted_at is null
        )
      )
  ) then
    raise exception
      'user_event_completions: no matching visible event row for (user_id, client_event_id, flow_id)';
  end if;

  return new;
end;
$$;

create or replace function public.record_event_completion(
  p_client_event_id text,
  p_flow_id bigint,
  p_completed_on date,
  p_source text default 'client'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    raise exception 'client_event_id required';
  end if;

  if p_flow_id is null then
    raise exception 'flow_id required';
  end if;

  if p_completed_on is null then
    raise exception 'completed_on required';
  end if;

  if not exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = p_flow_id
    where ue.client_event_id = p_client_event_id
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
      and (
        ue.user_id = v_uid
        or exists (
          select 1
          from public.shared_calendar_members scm
          join public.shared_calendars sc
            on sc.id = scm.calendar_id
          where scm.calendar_id = ue.calendar_id
            and scm.user_id = v_uid
            and scm.status = 'accepted'
            and sc.deleted_at is null
        )
      )
  ) then
    raise exception 'event not found or not visible to current member';
  end if;

  insert into public.user_event_completions (
    user_id,
    client_event_id,
    flow_id,
    completed_on,
    completed_at,
    source
  )
  values (
    v_uid,
    p_client_event_id,
    p_flow_id,
    p_completed_on,
    now(),
    coalesce(p_source, 'client')
  )
  on conflict (user_id, client_event_id) do update
    set flow_id = excluded.flow_id,
        completed_on = excluded.completed_on,
        completed_at = excluded.completed_at,
        source = excluded.source;
end;
$$;

comment on function public.record_event_completion(text, bigint, date, text) is
'Validates ownership or accepted shared-calendar membership and upserts a completion keyed by client_event_id + completed_on.';

revoke all on function public.record_event_completion(text, bigint, date, text)
from public;
grant execute on function public.record_event_completion(text, bigint, date, text)
to authenticated;

create or replace function public.create_shared_practice_from_flow(
  p_calendar_id uuid,
  p_source_flow_id bigint,
  p_start_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_shared_flow_id bigint;
  v_source_flow public.flows%rowtype;
  v_target_start date := coalesce(p_start_date, current_date);
  v_first_source_date date;
  v_day_delta integer := 0;
  v_total_steps integer := 0;
  v_flow_key text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_calendar_id is null then
    raise exception 'CALENDAR_REQUIRED';
  end if;

  if coalesce(p_source_flow_id, 0) <= 0 then
    raise exception 'SOURCE_FLOW_REQUIRED';
  end if;

  if not public.shared_practice_can_edit_calendar(p_calendar_id, v_uid) then
    raise exception 'CALENDAR_NOT_EDITABLE';
  end if;

  select *
    into v_source_flow
  from public.flows f
  where f.id = p_source_flow_id
    and (
      f.user_id = v_uid
      or exists (
        select 1
        from public.flow_posts fp
        where fp.flow_id = f.id
          and coalesce(fp.is_hidden, false) = false
      )
      or exists (
        select 1
        from public.shared_calendar_members scm
        join public.shared_calendars sc
          on sc.id = scm.calendar_id
        where scm.calendar_id = f.calendar_id
          and scm.user_id = v_uid
          and scm.status = 'accepted'
          and sc.deleted_at is null
      )
    )
  limit 1;

  if not found then
    raise exception 'SOURCE_FLOW_NOT_VISIBLE';
  end if;

  select spr.id, spr.shared_flow_id
    into v_room_id, v_shared_flow_id
  from public.shared_practice_rooms spr
  where spr.calendar_id = p_calendar_id
    and spr.source_flow_id = p_source_flow_id
    and coalesce(spr.start_date, date '0001-01-01') =
        coalesce(v_target_start, date '0001-01-01')
    and spr.status = 'active'
  order by spr.created_at desc
  limit 1;

  if v_room_id is not null then
    return v_room_id;
  end if;

  select
    min((ue.starts_at at time zone coalesce(nullif(public._get_user_timezone(v_uid), ''), 'UTC'))::date),
    count(*)::integer
    into v_first_source_date, v_total_steps
  from public.user_events ue
  where (
      ue.user_id = v_source_flow.user_id
      or (
        v_source_flow.calendar_id is not null
        and ue.calendar_id = v_source_flow.calendar_id
      )
    )
    and public.user_event_matches_flow(
      v_source_flow.id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail,
      ue.action_id,
      v_source_flow.ai_metadata
    )
    and coalesce(ue.category, '') <> 'tombstone';

  if v_first_source_date is not null then
    v_day_delta := v_target_start - v_first_source_date;
  end if;

  v_flow_key := nullif(btrim(v_source_flow.ai_metadata ->> 'flow_key'), '');

  insert into public.flows (
    user_id,
    calendar_id,
    name,
    color,
    active,
    start_date,
    end_date,
    notes,
    rules,
    is_hidden,
    is_reminder,
    is_saved,
    origin_type,
    origin_flow_id,
    root_flow_id,
    ai_metadata
  )
  values (
    v_uid,
    p_calendar_id,
    v_source_flow.name,
    v_source_flow.color,
    true,
    case
      when v_source_flow.start_date is null then v_target_start
      else v_source_flow.start_date + v_day_delta
    end,
    case
      when v_source_flow.end_date is null then null
      else v_source_flow.end_date + v_day_delta
    end,
    v_source_flow.notes,
    coalesce(v_source_flow.rules, '[]'::jsonb),
    false,
    false,
    false,
    'fork',
    v_source_flow.id,
    coalesce(v_source_flow.root_flow_id, v_source_flow.origin_flow_id, v_source_flow.id),
    coalesce(v_source_flow.ai_metadata, '{}'::jsonb) || jsonb_build_object(
      'shared_practice_source_flow_id', v_source_flow.id,
      'shared_practice_calendar_id', p_calendar_id::text
    )
  )
  returning id into v_shared_flow_id;

  insert into public.shared_practice_rooms (
    calendar_id,
    source_flow_id,
    shared_flow_id,
    created_by,
    title,
    flow_key,
    start_date,
    end_date
  )
  values (
    p_calendar_id,
    v_source_flow.id,
    v_shared_flow_id,
    v_uid,
    v_source_flow.name,
    v_flow_key,
    case
      when v_source_flow.start_date is null then v_target_start
      else v_source_flow.start_date + v_day_delta
    end,
    case
      when v_source_flow.end_date is null then null
      else v_source_flow.end_date + v_day_delta
    end
  )
  returning id into v_room_id;

  with source_events as (
    select
      ue.*,
      row_number() over (order by ue.starts_at asc, ue.created_at asc, ue.id asc) as step_index,
      count(*) over () as step_total
    from public.user_events ue
    where (
        ue.user_id = v_source_flow.user_id
        or (
          v_source_flow.calendar_id is not null
          and ue.calendar_id = v_source_flow.calendar_id
        )
      )
      and public.user_event_matches_flow(
        v_source_flow.id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        v_source_flow.ai_metadata
      )
      and coalesce(ue.category, '') <> 'tombstone'
  )
  insert into public.user_events (
    user_id,
    calendar_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    category,
    action_id,
    behavior_payload
  )
  select
    v_uid,
    p_calendar_id,
    'shared_practice:' || v_room_id::text || ':' ||
      md5(coalesce(se.client_event_id, se.id::text)),
    se.title,
    se.detail,
    se.location,
    coalesce(se.all_day, false),
    se.starts_at + (v_day_delta::text || ' days')::interval,
    case
      when se.ends_at is null then null
      else se.ends_at + (v_day_delta::text || ' days')::interval
    end,
    v_shared_flow_id,
    se.category,
    se.action_id,
    coalesce(se.behavior_payload, '{}'::jsonb) || jsonb_build_object(
      'shared_practice_room_id', v_room_id::text,
      'source_flow_id', v_source_flow.id,
      'shared_flow_id', v_shared_flow_id,
      'shared_calendar_id', p_calendar_id::text,
      'source_client_event_id', se.client_event_id,
      'flow_step_index', se.step_index,
      'flow_total_steps', coalesce(nullif(se.step_total, 0), v_total_steps)
    )
  from source_events se;

  return v_room_id;
end;
$$;

revoke all on function public.create_shared_practice_from_flow(uuid, bigint, date)
from public;
grant execute on function public.create_shared_practice_from_flow(uuid, bigint, date)
to authenticated;

create or replace function public.mark_shared_step_opened(
  p_room_id uuid,
  p_client_event_id text,
  p_opened_on date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_calendar_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select calendar_id
    into v_calendar_id
  from public.shared_practice_rooms
  where id = p_room_id
    and status = 'active';

  if v_calendar_id is null then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if not public.shared_practice_is_calendar_member(v_calendar_id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;

  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    raise exception 'CLIENT_EVENT_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.user_events ue
    where ue.calendar_id = v_calendar_id
      and ue.client_event_id = p_client_event_id
      and ue.behavior_payload ->> 'shared_practice_room_id' = p_room_id::text
  ) then
    raise exception 'STEP_NOT_FOUND';
  end if;

  insert into public.shared_practice_presence (
    room_id,
    user_id,
    client_event_id,
    opened_on
  )
  values (
    p_room_id,
    v_uid,
    p_client_event_id,
    coalesce(p_opened_on, current_date)
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.mark_shared_step_opened(uuid, text, date)
from public;
grant execute on function public.mark_shared_step_opened(uuid, text, date)
to authenticated;

create or replace function public.upsert_shared_practice_entry(
  p_room_id uuid,
  p_client_event_id text,
  p_flow_id bigint,
  p_completed_on date,
  p_completion_status text,
  p_body_text text,
  p_visibility text default 'private'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_calendar_id uuid;
  v_status text := lower(coalesce(nullif(btrim(p_completion_status), ''), ''));
  v_visibility text := lower(coalesce(nullif(btrim(p_visibility), ''), 'private'));
  v_body text := nullif(btrim(p_body_text), '');
  v_entry public.shared_practice_entries%rowtype;
  v_metadata jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select spr.calendar_id
    into v_calendar_id
  from public.shared_practice_rooms spr
  where spr.id = p_room_id
    and spr.status = 'active';

  if v_calendar_id is null then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if not public.shared_practice_is_calendar_member(v_calendar_id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;

  if v_status not in ('observed', 'partial', 'skipped') then
    raise exception 'INVALID_COMPLETION_STATUS';
  end if;

  if v_visibility not in ('private', 'shared_with_calendar') then
    raise exception 'INVALID_VISIBILITY';
  end if;

  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    raise exception 'CLIENT_EVENT_REQUIRED';
  end if;

  if coalesce(p_flow_id, 0) <= 0 then
    raise exception 'FLOW_REQUIRED';
  end if;

  if p_completed_on is null then
    raise exception 'COMPLETED_ON_REQUIRED';
  end if;

  perform public.record_event_completion(
    p_client_event_id,
    p_flow_id,
    p_completed_on,
    'shared_practice'
  );

  v_metadata := jsonb_build_object(
    'status', case
      when v_status = 'partial' then 'observed_partly'
      else v_status
    end,
    'completion_status', v_status,
    'reflection_status', 'none',
    'source_type', 'maat_flow',
    'completed_on', p_completed_on::text,
    'shared_practice_room_id', p_room_id::text,
    'visibility', v_visibility
  );

  update public.user_event_completions
     set metadata = coalesce(metadata, '{}'::jsonb) || v_metadata
   where user_id = v_uid
     and client_event_id = p_client_event_id;

  insert into public.shared_practice_entries (
    room_id,
    user_id,
    client_event_id,
    flow_id,
    completed_on,
    completion_status,
    body_text,
    visibility
  )
  values (
    p_room_id,
    v_uid,
    p_client_event_id,
    p_flow_id,
    p_completed_on,
    v_status,
    v_body,
    v_visibility
  )
  on conflict (room_id, user_id, completed_on, client_event_id)
  do update
    set flow_id = excluded.flow_id,
        completion_status = excluded.completion_status,
        body_text = excluded.body_text,
        visibility = excluded.visibility,
        moderation_status = case
          when public.shared_practice_entries.moderation_status = 'hidden'
          then public.shared_practice_entries.moderation_status
          else 'visible'
        end,
        updated_at = now()
  returning * into v_entry;

  return jsonb_build_object(
    'id', v_entry.id,
    'room_id', v_entry.room_id,
    'user_id', v_entry.user_id,
    'client_event_id', v_entry.client_event_id,
    'flow_id', v_entry.flow_id,
    'completed_on', v_entry.completed_on,
    'completion_status', v_entry.completion_status,
    'body_text', v_entry.body_text,
    'visibility', v_entry.visibility,
    'moderation_status', v_entry.moderation_status,
    'created_at', v_entry.created_at,
    'updated_at', v_entry.updated_at
  );
end;
$$;

revoke all on function public.upsert_shared_practice_entry(uuid, text, bigint, date, text, text, text)
from public;
grant execute on function public.upsert_shared_practice_entry(uuid, text, bigint, date, text, text, text)
to authenticated;

create or replace function public.get_shared_practice_room(
  p_room_id uuid,
  p_local_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.shared_practice_rooms%rowtype;
  v_calendar public.shared_calendars%rowtype;
  v_local_date date := coalesce(p_local_date, current_date);
  v_timezone text;
  v_step jsonb := null;
  v_members jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_total_steps integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_room
  from public.shared_practice_rooms
  where id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if not public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;

  select *
    into v_calendar
  from public.shared_calendars
  where id = v_room.calendar_id
    and deleted_at is null;

  v_timezone := coalesce(nullif(public._get_user_timezone(v_uid), ''), 'UTC');

  select count(*)::integer
    into v_total_steps
  from public.user_events ue
  where ue.calendar_id = v_room.calendar_id
    and ue.behavior_payload ->> 'shared_practice_room_id' = v_room.id::text
    and coalesce(ue.category, '') <> 'tombstone';

  select jsonb_build_object(
    'id', ue.id,
    'client_event_id', ue.client_event_id,
    'flow_id', ue.flow_local_id,
    'title', ue.title,
    'detail', ue.detail,
    'starts_at', ue.starts_at,
    'ends_at', ue.ends_at,
    'all_day', ue.all_day,
    'step_index', public.try_parse_bigint(ue.behavior_payload ->> 'flow_step_index'),
    'total_steps', coalesce(
      public.try_parse_bigint(ue.behavior_payload ->> 'flow_total_steps')::integer,
      v_total_steps
    )
  )
    into v_step
  from public.user_events ue
  where ue.calendar_id = v_room.calendar_id
    and ue.behavior_payload ->> 'shared_practice_room_id' = v_room.id::text
    and coalesce(ue.category, '') <> 'tombstone'
    and (ue.starts_at at time zone v_timezone)::date = v_local_date
  order by ue.starts_at asc, ue.created_at asc, ue.id asc
  limit 1;

  with room_events as (
    select ue.client_event_id
    from public.user_events ue
    where ue.calendar_id = v_room.calendar_id
      and ue.behavior_payload ->> 'shared_practice_room_id' = v_room.id::text
      and coalesce(ue.category, '') <> 'tombstone'
  ),
  today_completion as (
    select
      uec.user_id,
      uec.client_event_id,
      uec.flow_id,
      uec.metadata,
      coalesce(
        nullif(uec.metadata ->> 'completion_status', ''),
        case when uec.id is not null then 'observed' else null end
      ) as completion_status
    from public.user_event_completions uec
    where v_step is not null
      and uec.client_event_id = v_step ->> 'client_event_id'
      and uec.completed_on = v_local_date
  ),
  progress as (
    select
      uec.user_id,
      count(distinct uec.client_event_id)::integer as completed_count
    from public.user_event_completions uec
    join room_events re
      on re.client_event_id = uec.client_event_id
    group by uec.user_id
  ),
  member_rows as (
    select
      scm.user_id,
      scm.role,
      p.handle,
      p.display_name,
      p.avatar_url,
      tc.client_event_id,
      tc.flow_id,
      tc.completion_status,
      coalesce(pr.completed_count, 0) as completed_count,
      spe.id as entry_id,
      spe.visibility as entry_visibility,
      spe.moderation_status as entry_moderation_status,
      nullif(btrim(coalesce(spe.body_text, '')), '') is not null as entry_has_body,
      case
        when spe.id is null then false
        when spe.user_id = v_uid then true
        when spe.visibility = 'shared_with_calendar'
          and spe.moderation_status = 'visible'
          and nullif(btrim(coalesce(spe.body_text, '')), '') is not null
        then true
        else false
      end as entry_available_to_viewer,
      exists (
        select 1
        from public.shared_practice_presence spp
        where spp.room_id = v_room.id
          and spp.user_id = scm.user_id
          and spp.opened_on = v_local_date
          and (
            v_step is null
            or spp.client_event_id = v_step ->> 'client_event_id'
          )
      ) as opened_today
    from public.shared_calendar_members scm
    left join public.profiles p
      on p.id = scm.user_id
    left join today_completion tc
      on tc.user_id = scm.user_id
    left join progress pr
      on pr.user_id = scm.user_id
    left join public.shared_practice_entries spe
      on spe.room_id = v_room.id
     and spe.user_id = scm.user_id
     and spe.completed_on = v_local_date
     and (
       v_step is null
       or spe.client_event_id = v_step ->> 'client_event_id'
     )
    where scm.calendar_id = v_room.calendar_id
      and scm.status = 'accepted'
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', user_id,
        'role', role,
        'handle', handle,
        'display_name', display_name,
        'avatar_url', avatar_url,
        'completion_status', completion_status,
        'presence_status', case
          when completion_status is not null then null
          when opened_today then 'carrying'
          else 'not_yet'
        end,
        'completed_count', completed_count,
        'total_count', v_total_steps,
        'entry_id', case
          when entry_available_to_viewer then entry_id
          else null
        end,
        'entry_visibility', case
          when entry_available_to_viewer then entry_visibility
          else null
        end,
        'entry_has_body', case
          when entry_available_to_viewer then entry_has_body
          else false
        end,
        'entry_available_to_viewer', entry_available_to_viewer
      )
      order by
        case role when 'owner' then 0 when 'editor' then 1 else 2 end,
        coalesce(nullif(btrim(display_name), ''), nullif(btrim(handle), ''), user_id::text)
    ),
    '[]'::jsonb
  )
    into v_members
  from member_rows;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', spe.id,
        'room_id', spe.room_id,
        'user_id', spe.user_id,
        'client_event_id', spe.client_event_id,
        'flow_id', spe.flow_id,
        'completed_on', spe.completed_on,
        'completion_status', spe.completion_status,
        'body_text', spe.body_text,
        'visibility', spe.visibility,
        'moderation_status', spe.moderation_status,
        'created_at', spe.created_at,
        'updated_at', spe.updated_at,
        'author_handle', p.handle,
        'author_display_name', p.display_name,
        'author_avatar_url', p.avatar_url
      )
      order by spe.created_at desc
    ),
    '[]'::jsonb
  )
    into v_entries
  from public.shared_practice_entries spe
  left join public.profiles p
    on p.id = spe.user_id
  where spe.room_id = v_room.id
    and spe.completed_on = v_local_date
    and spe.moderation_status = 'visible'
    and nullif(btrim(coalesce(spe.body_text, '')), '') is not null
    and (
      spe.user_id = v_uid
      or spe.visibility = 'shared_with_calendar'
    );

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'calendar_id', v_room.calendar_id,
      'source_flow_id', v_room.source_flow_id,
      'shared_flow_id', v_room.shared_flow_id,
      'created_by', v_room.created_by,
      'title', v_room.title,
      'flow_key', v_room.flow_key,
      'start_date', v_room.start_date,
      'end_date', v_room.end_date,
      'status', v_room.status,
      'created_at', v_room.created_at,
      'updated_at', v_room.updated_at
    ),
    'calendar', jsonb_build_object(
      'id', v_calendar.id,
      'owner_id', v_calendar.owner_id,
      'name', v_calendar.name,
      'color', v_calendar.color,
      'icon', v_calendar.icon,
      'is_personal', v_calendar.is_personal
    ),
    'local_date', v_local_date,
    'today_step', v_step,
    'members', v_members,
    'entries', v_entries
  );
end;
$$;

revoke all on function public.get_shared_practice_room(uuid, date)
from public;
grant execute on function public.get_shared_practice_room(uuid, date)
to authenticated;

grant select, insert, update on public.shared_practice_rooms to authenticated;
grant select, insert, update, delete on public.shared_practice_entries to authenticated;
grant select, insert on public.shared_practice_presence to authenticated;

notify pgrst, 'reload schema';
