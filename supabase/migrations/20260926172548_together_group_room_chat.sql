-- Together group rooms are a social overlay on the creator's existing flow.
-- The host's current occurrence remains authoritative; participants do not
-- receive a copied flow or calendar. Chat is private to accepted members.

create table if not exists public.shared_practice_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.shared_practice_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  host_client_event_id text,
  flow_id bigint,
  flow_day date not null,
  body_text text not null,
  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shared_practice_messages_body_check
    check (
      char_length(btrim(body_text)) between 1 and 2000
    )
);

create index if not exists shared_practice_messages_room_day_idx
  on public.shared_practice_messages(room_id, flow_day, created_at, id)
  where deleted_at is null and moderation_status = 'visible';

create index if not exists shared_practice_messages_user_idx
  on public.shared_practice_messages(user_id, created_at desc)
  where deleted_at is null;

drop trigger if exists trg_touch_shared_practice_messages_updated_at
on public.shared_practice_messages;
create trigger trg_touch_shared_practice_messages_updated_at
before update on public.shared_practice_messages
for each row
execute function public.touch_shared_practice_updated_at();

alter table public.shared_practice_messages enable row level security;

drop policy if exists shared_practice_messages_select_members
on public.shared_practice_messages;
create policy shared_practice_messages_select_members
on public.shared_practice_messages
for select
to authenticated
using (
  public.shared_practice_is_room_member(room_id, (select auth.uid()))
);

-- Message mutations go through RPCs so room membership and host position are
-- validated together. Direct client writes are intentionally unavailable.
revoke all on table public.shared_practice_messages from anon, authenticated;
grant select on table public.shared_practice_messages to authenticated;

do $do$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_practice_messages'
  ) then
    alter publication supabase_realtime
      add table public.shared_practice_messages;
  end if;
end;
$do$;

create or replace function private.together_host_step(
  p_room_id uuid,
  p_host_date date default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with room_flow as (
    select
      room.id as room_id,
      room.source_flow_id,
      room.created_by,
      coalesce(
        p_host_date,
        (now() at time zone coalesce(
          nullif(public._get_user_timezone(room.created_by), ''),
          'UTC'
        ))::date
      ) as host_date,
      flow.ai_metadata
    from public.shared_practice_rooms room
    join public.flows flow
      on flow.id = room.source_flow_id
     and flow.user_id = room.created_by
    where room.id = p_room_id
      and room.calendar_id is null
      and room.status = 'active'
  ),
  matching_events as (
    select
      event.id,
      event.client_event_id,
      event.flow_local_id,
      event.title,
      event.detail,
      event.starts_at,
      event.ends_at,
      event.all_day,
      event.created_at,
      event.behavior_payload,
      room_flow.source_flow_id,
      room_flow.host_date,
      coalesce(
        nullif(public._get_user_timezone(room_flow.created_by), ''),
        'UTC'
      ) as host_timezone
    from room_flow
    join public.user_events event
      on event.user_id = room_flow.created_by
     and public.user_event_matches_flow(
       room_flow.source_flow_id,
       event.flow_local_id,
       event.client_event_id,
       event.detail,
       event.action_id,
       room_flow.ai_metadata
     )
    where coalesce(event.category, '') <> 'tombstone'
  ),
  numbered_events as (
    select
      matching_events.*,
      row_number() over (
        order by starts_at, created_at, id
      )::integer as step_index,
      count(*) over ()::integer as total_steps
    from matching_events
  )
  select jsonb_build_object(
    'id', event.id,
    'client_event_id', event.client_event_id,
    'flow_id', event.source_flow_id,
    'title', event.title,
    'detail', event.detail,
    'starts_at', event.starts_at,
    'ends_at', event.ends_at,
    'all_day', event.all_day,
    'step_index', coalesce(
      public.try_parse_bigint(
        event.behavior_payload ->> 'flow_step_index'
      )::integer,
      event.step_index
    ),
    'total_steps', coalesce(
      public.try_parse_bigint(
        event.behavior_payload ->> 'flow_total_steps'
      )::integer,
      event.total_steps
    ),
    'host_date', event.host_date
  )
  from numbered_events event
  where (event.starts_at at time zone event.host_timezone)::date =
    event.host_date
  order by event.starts_at, event.created_at, event.id
  limit 1
$$;

create or replace function public.send_shared_practice_message(
  p_room_id uuid,
  p_body_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body_text, '')), '');
  v_room public.shared_practice_rooms%rowtype;
  v_step jsonb;
  v_flow_day date;
  v_message public.shared_practice_messages%rowtype;
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_body is null or char_length(v_body) > 2000 then
    raise exception 'INVALID_MESSAGE';
  end if;

  select *
    into v_room
  from public.shared_practice_rooms room
  where room.id = p_room_id
    and room.status = 'active';

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if not public.shared_practice_is_room_member(v_room.id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;

  if v_room.calendar_id is null then
    v_step := private.together_host_step(v_room.id, null);
    v_flow_day := coalesce(
      (v_step ->> 'host_date')::date,
      (now() at time zone coalesce(
        nullif(public._get_user_timezone(v_room.created_by), ''),
        'UTC'
      ))::date
    );
  else
    v_flow_day := current_date;
  end if;

  insert into public.shared_practice_messages (
    room_id,
    user_id,
    host_client_event_id,
    flow_id,
    flow_day,
    body_text
  ) values (
    v_room.id,
    v_uid,
    nullif(v_step ->> 'client_event_id', ''),
    coalesce(
      public.try_parse_bigint(v_step ->> 'flow_id'),
      v_room.source_flow_id
    ),
    v_flow_day,
    v_body
  )
  returning * into v_message;

  select * into v_profile
  from public.profiles profile
  where profile.id = v_uid;

  return jsonb_build_object(
    'id', v_message.id,
    'room_id', v_message.room_id,
    'user_id', v_message.user_id,
    'host_client_event_id', v_message.host_client_event_id,
    'flow_id', v_message.flow_id,
    'flow_day', v_message.flow_day,
    'body_text', v_message.body_text,
    'created_at', v_message.created_at,
    'updated_at', v_message.updated_at,
    'author_handle', v_profile.handle,
    'author_display_name', v_profile.display_name,
    'author_avatar_url', v_profile.avatar_url
  );
end;
$$;

create or replace function public.delete_shared_practice_message(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_practice_messages message
     set deleted_at = now(),
         updated_at = now()
   where message.id = p_message_id
     and message.deleted_at is null
     and (
       message.user_id = v_uid
       or public.shared_practice_can_manage_room(message.room_id, v_uid)
     );

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.mark_shared_step_opened(
  p_room_id uuid,
  p_client_event_id text,
  p_opened_on date
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.shared_practice_rooms%rowtype;
  v_step jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_room
  from public.shared_practice_rooms room
  where room.id = p_room_id
    and room.status = 'active';

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if not public.shared_practice_is_room_member(v_room.id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;
  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    raise exception 'CLIENT_EVENT_REQUIRED';
  end if;

  if v_room.calendar_id is null then
    v_step := private.together_host_step(v_room.id, null);
    if coalesce(v_step ->> 'client_event_id', '') <> p_client_event_id then
      raise exception 'STEP_NOT_FOUND';
    end if;
  elsif not exists (
    select 1
    from public.user_events event
    where event.calendar_id = v_room.calendar_id
      and event.client_event_id = p_client_event_id
      and event.behavior_payload ->> 'shared_practice_room_id' =
        p_room_id::text
  ) then
    raise exception 'STEP_NOT_FOUND';
  end if;

  insert into public.shared_practice_presence (
    room_id,
    user_id,
    client_event_id,
    opened_on
  ) values (
    p_room_id,
    v_uid,
    p_client_event_id,
    coalesce(p_opened_on, current_date)
  )
  on conflict do nothing;
end;
$$;

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
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.shared_practice_rooms%rowtype;
  v_step jsonb;
  v_status text := lower(coalesce(nullif(btrim(p_completion_status), ''), ''));
  v_visibility text := lower(
    coalesce(nullif(btrim(p_visibility), ''), 'private')
  );
  v_body text := nullif(btrim(p_body_text), '');
  v_entry public.shared_practice_entries%rowtype;
  v_metadata jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_room
  from public.shared_practice_rooms room
  where room.id = p_room_id
    and room.status = 'active';

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if not public.shared_practice_is_room_member(v_room.id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;
  if v_status not in ('observed', 'partial', 'skipped') then
    raise exception 'INVALID_COMPLETION_STATUS';
  end if;
  if v_visibility not in ('private', 'shared_with_calendar', 'public') then
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

  if v_room.calendar_id is null then
    v_step := private.together_host_step(v_room.id, null);
    if coalesce(v_step ->> 'client_event_id', '') <> p_client_event_id
       or coalesce(
         public.try_parse_bigint(v_step ->> 'flow_id'),
         0
       ) <> p_flow_id then
      raise exception 'STEP_NOT_FOUND';
    end if;

    -- The room is only a social overlay on the creator's original flow.
    -- Preserve the existing completion behavior for the creator while every
    -- other member keeps independent room-scoped progress below.
    if v_uid = v_room.created_by then
      perform public.record_event_completion(
        p_client_event_id,
        p_flow_id,
        p_completed_on,
        'shared_practice'
      );
    end if;
  else
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
  end if;

  insert into public.shared_practice_entries (
    room_id,
    user_id,
    client_event_id,
    flow_id,
    completed_on,
    completion_status,
    body_text,
    visibility
  ) values (
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
  do update set
    flow_id = excluded.flow_id,
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

create or replace function public.get_shared_practice_room(
  p_room_id uuid,
  p_local_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.shared_practice_rooms%rowtype;
  v_calendar public.shared_calendars%rowtype;
  v_flow public.flows%rowtype;
  v_local_date date := coalesce(p_local_date, current_date);
  v_timezone text;
  v_step jsonb := null;
  v_members jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
  v_join_requests jsonb := '[]'::jsonb;
  v_source_flow jsonb := null;
  v_total_steps integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_room
  from public.shared_practice_rooms room
  where room.id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if not public.shared_practice_can_read_room(v_room.id, v_uid)
     or (
       v_room.calendar_id is null
       and not public.shared_practice_is_room_member(v_room.id, v_uid)
     ) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;

  select * into v_flow
  from public.flows flow
  where flow.id = v_room.source_flow_id
    and flow.user_id = v_room.created_by;

  if v_room.calendar_id is null then
    v_step := private.together_host_step(v_room.id, null);
    v_local_date := coalesce(
      (v_step ->> 'host_date')::date,
      (now() at time zone coalesce(
        nullif(public._get_user_timezone(v_room.created_by), ''),
        'UTC'
      ))::date
    );
    v_total_steps := coalesce(
      public.try_parse_bigint(v_step ->> 'total_steps')::integer,
      0
    );
  else
    select * into v_calendar
    from public.shared_calendars calendar
    where calendar.id = v_room.calendar_id
      and calendar.deleted_at is null;

    v_timezone := coalesce(
      nullif(public._get_user_timezone(v_uid), ''),
      'UTC'
    );

    select count(*)::integer into v_total_steps
    from public.user_events event
    where event.calendar_id = v_room.calendar_id
      and event.behavior_payload ->> 'shared_practice_room_id' =
        v_room.id::text
      and coalesce(event.category, '') <> 'tombstone';

    select jsonb_build_object(
      'id', event.id,
      'client_event_id', event.client_event_id,
      'flow_id', event.flow_local_id,
      'title', event.title,
      'detail', event.detail,
      'starts_at', event.starts_at,
      'ends_at', event.ends_at,
      'all_day', event.all_day,
      'step_index', public.try_parse_bigint(
        event.behavior_payload ->> 'flow_step_index'
      ),
      'total_steps', coalesce(
        public.try_parse_bigint(
          event.behavior_payload ->> 'flow_total_steps'
        )::integer,
        v_total_steps
      )
    ) into v_step
    from public.user_events event
    where event.calendar_id = v_room.calendar_id
      and event.behavior_payload ->> 'shared_practice_room_id' =
        v_room.id::text
      and coalesce(event.category, '') <> 'tombstone'
      and (event.starts_at at time zone v_timezone)::date = v_local_date
    order by event.starts_at, event.created_at, event.id
    limit 1;
  end if;

  with member_source as (
    select
      member.user_id,
      member.role,
      member.public_identity
    from public.shared_practice_room_members member
    where v_room.calendar_id is null
      and member.room_id = v_room.id
      and member.status = 'accepted'
    union all
    select
      member.user_id,
      member.role,
      false as public_identity
    from public.shared_calendar_members member
    where v_room.calendar_id is not null
      and member.calendar_id = v_room.calendar_id
      and member.status = 'accepted'
  ),
  progress as (
    select
      entry.user_id,
      count(distinct entry.client_event_id)::integer as completed_count
    from public.shared_practice_entries entry
    where entry.room_id = v_room.id
    group by entry.user_id
  ),
  member_rows as (
    select
      member.user_id,
      member.role,
      member.public_identity,
      profile.handle,
      profile.display_name,
      profile.avatar_url,
      entry.completion_status,
      coalesce(progress.completed_count, 0) as completed_count,
      entry.id as entry_id,
      entry.visibility as entry_visibility,
      nullif(btrim(coalesce(entry.body_text, '')), '') is not null
        as entry_has_body,
      case
        when entry.id is null then false
        when entry.user_id = v_uid then true
        when entry.moderation_status = 'visible'
          and nullif(btrim(coalesce(entry.body_text, '')), '') is not null
          and entry.visibility in ('shared_with_calendar', 'public')
          and public.shared_practice_is_room_member(v_room.id, v_uid)
          then true
        else false
      end as entry_available_to_viewer,
      exists (
        select 1
        from public.shared_practice_presence presence
        where presence.room_id = v_room.id
          and presence.user_id = member.user_id
          and presence.opened_on = v_local_date
          and (
            v_step is null
            or presence.client_event_id = v_step ->> 'client_event_id'
          )
      ) as opened_today
    from member_source member
    left join public.profiles profile on profile.id = member.user_id
    left join progress on progress.user_id = member.user_id
    left join public.shared_practice_entries entry
      on entry.room_id = v_room.id
     and entry.user_id = member.user_id
     and entry.completed_on = v_local_date
     and (
       v_step is null
       or entry.client_event_id = v_step ->> 'client_event_id'
     )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', user_id,
        'role', role,
        'public_identity', public_identity,
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
        case role
          when 'host' then 0
          when 'owner' then 0
          when 'editor' then 1
          else 2
        end,
        coalesce(
          nullif(btrim(display_name), ''),
          nullif(btrim(handle), ''),
          user_id::text
        )
    ),
    '[]'::jsonb
  ) into v_members
  from member_rows;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', entry.id,
        'room_id', entry.room_id,
        'user_id', entry.user_id,
        'client_event_id', entry.client_event_id,
        'flow_id', entry.flow_id,
        'completed_on', entry.completed_on,
        'completion_status', entry.completion_status,
        'body_text', entry.body_text,
        'visibility', entry.visibility,
        'moderation_status', entry.moderation_status,
        'created_at', entry.created_at,
        'updated_at', entry.updated_at,
        'author_handle', profile.handle,
        'author_display_name', profile.display_name,
        'author_avatar_url', profile.avatar_url
      ) order by entry.created_at desc
    ),
    '[]'::jsonb
  ) into v_entries
  from public.shared_practice_entries entry
  left join public.profiles profile on profile.id = entry.user_id
  where entry.room_id = v_room.id
    and entry.completed_on = v_local_date
    and entry.moderation_status = 'visible'
    and nullif(btrim(coalesce(entry.body_text, '')), '') is not null
    and (
      entry.user_id = v_uid
      or (
        public.shared_practice_is_room_member(v_room.id, v_uid)
        and entry.visibility in ('shared_with_calendar', 'public')
      )
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', message.id,
        'room_id', message.room_id,
        'user_id', message.user_id,
        'host_client_event_id', message.host_client_event_id,
        'flow_id', message.flow_id,
        'flow_day', message.flow_day,
        'body_text', message.body_text,
        'created_at', message.created_at,
        'updated_at', message.updated_at,
        'author_handle', profile.handle,
        'author_display_name', profile.display_name,
        'author_avatar_url', profile.avatar_url
      ) order by message.created_at, message.id
    ),
    '[]'::jsonb
  ) into v_messages
  from public.shared_practice_messages message
  left join public.profiles profile on profile.id = message.user_id
  where message.room_id = v_room.id
    and message.flow_day = v_local_date
    and message.deleted_at is null
    and message.moderation_status = 'visible';

  if public.shared_practice_can_manage_room(v_room.id, v_uid) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', request.id,
          'room_id', request.room_id,
          'requester_id', request.requester_id,
          'message', request.message,
          'status', request.status,
          'created_at', request.created_at,
          'updated_at', request.updated_at,
          'responded_at', request.responded_at,
          'requester_handle', profile.handle,
          'requester_display_name', profile.display_name,
          'requester_avatar_url', profile.avatar_url
        ) order by request.created_at
      ),
      '[]'::jsonb
    ) into v_join_requests
    from public.shared_practice_join_requests request
    left join public.profiles profile on profile.id = request.requester_id
    where request.room_id = v_room.id
      and request.status = 'pending';
  end if;

  if v_flow.id is not null then
    v_source_flow := jsonb_build_object(
      'id', v_flow.id,
      'user_id', v_flow.user_id,
      'calendar_id', v_flow.calendar_id,
      'name', v_flow.name,
      'color', v_flow.color,
      'start_date', v_flow.start_date,
      'end_date', v_flow.end_date,
      'notes', v_flow.notes,
      'ai_metadata', v_flow.ai_metadata,
      'appearance', v_flow.appearance
    );
  end if;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'calendar_id', v_room.calendar_id,
      'source_flow_id', v_room.source_flow_id,
      'shared_flow_id', v_room.shared_flow_id,
      'created_by', v_room.created_by,
      'title', v_room.title,
      'description', v_room.description,
      'flow_key', v_room.flow_key,
      'start_date', v_room.start_date,
      'end_date', v_room.end_date,
      'status', v_room.status,
      'visibility', v_room.visibility,
      'join_policy', v_room.join_policy,
      'request_audience', v_room.request_audience,
      'member_count', public.shared_practice_accepted_member_count(
        v_room.id
      ),
      'pending_request_count', case
        when public.shared_practice_can_manage_room(v_room.id, v_uid)
          then (
            select count(*)
            from public.shared_practice_join_requests request
            where request.room_id = v_room.id
              and request.status = 'pending'
          )
        else 0
      end,
      'created_at', v_room.created_at,
      'updated_at', v_room.updated_at
    ),
    'calendar', case
      when v_room.calendar_id is null then jsonb_build_object(
        'id', null,
        'owner_id', v_room.created_by,
        'name', 'Group flow',
        'color', coalesce(v_flow.color, 13938243),
        'icon', 'groups',
        'is_personal', false
      )
      else jsonb_build_object(
        'id', v_calendar.id,
        'owner_id', v_calendar.owner_id,
        'name', v_calendar.name,
        'color', v_calendar.color,
        'icon', v_calendar.icon,
        'is_personal', v_calendar.is_personal
      )
    end,
    'source_flow', v_source_flow,
    'local_date', v_local_date,
    'today_step', v_step - 'host_date',
    'members', v_members,
    'entries', v_entries,
    'messages', v_messages,
    'join_requests', v_join_requests,
    'viewer_can_edit', v_room.created_by = v_uid,
    'viewer_can_manage', public.shared_practice_can_manage_room(
      v_room.id,
      v_uid
    ),
    'viewer_is_member', public.shared_practice_is_room_member(
      v_room.id,
      v_uid
    )
  );
end;
$$;

create or replace function public.get_together_room_for_flow(
  p_flow_id bigint
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if coalesce(p_flow_id, 0) <= 0 then
    return null;
  end if;

  select room.id into v_room_id
  from public.shared_practice_rooms room
  where room.source_flow_id = p_flow_id
    and room.calendar_id is null
    and room.status = 'active'
    and public.shared_practice_accepted_member_count(room.id) >= 2
    and public.shared_practice_is_room_member(room.id, v_uid)
  order by room.updated_at desc, room.created_at desc
  limit 1;

  return v_room_id;
end;
$$;

revoke all on function private.together_host_step(uuid, date) from public;

revoke all on function public.send_shared_practice_message(uuid, text)
from public;
revoke all on function public.delete_shared_practice_message(uuid)
from public;
grant execute on function public.send_shared_practice_message(uuid, text)
to authenticated;
grant execute on function public.delete_shared_practice_message(uuid)
to authenticated;

revoke all on function public.mark_shared_step_opened(uuid, text, date)
from public;
grant execute on function public.mark_shared_step_opened(uuid, text, date)
to authenticated;

revoke all on function public.upsert_shared_practice_entry(
  uuid, text, bigint, date, text, text, text
) from public;
grant execute on function public.upsert_shared_practice_entry(
  uuid, text, bigint, date, text, text, text
) to authenticated;

revoke all on function public.get_shared_practice_room(uuid, date)
from public;
grant execute on function public.get_shared_practice_room(uuid, date)
to authenticated;

revoke all on function public.get_together_room_for_flow(bigint)
from public;
grant execute on function public.get_together_room_for_flow(bigint)
to authenticated;

notify pgrst, 'reload schema';
