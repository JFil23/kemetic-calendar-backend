begin;

-- Generic Together rooms begin private, including the host's public identity.
-- The host can opt in later through set_shared_practice_public_identity.
create or replace function private.ensure_together_overlay_for_flow(
  p_flow_id bigint,
  p_creator_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_flow public.flows%rowtype;
  v_room_id uuid;
begin
  select *
    into v_flow
  from public.flows flow
  where flow.id = p_flow_id
    and flow.user_id = p_creator_id
    and flow.active is true
    and coalesce(flow.is_hidden, false) is false
  for update;

  if not found then
    raise exception 'FLOW_NOT_ACTIVE';
  end if;

  select room.id
    into v_room_id
  from public.shared_practice_rooms room
  where room.source_flow_id = v_flow.id
    and room.created_by = p_creator_id
    and room.calendar_id is null
    and room.status = 'active'
  order by room.created_at desc
  limit 1;

  if v_room_id is null then
    insert into public.shared_practice_rooms (
      calendar_id,
      source_flow_id,
      shared_flow_id,
      created_by,
      title,
      flow_key,
      start_date,
      end_date,
      status,
      visibility,
      join_policy,
      request_audience
    )
    values (
      null,
      v_flow.id,
      null,
      p_creator_id,
      v_flow.name,
      nullif(btrim(v_flow.ai_metadata ->> 'flow_key'), ''),
      v_flow.start_date,
      v_flow.end_date,
      'active',
      'private',
      'owner_approval',
      'creator_friends'
    )
    returning id into v_room_id;
  end if;

  insert into public.shared_practice_room_members (
    room_id,
    user_id,
    role,
    status,
    invited_by,
    public_identity,
    responded_at
  )
  values (
    v_room_id,
    p_creator_id,
    'host',
    'accepted',
    p_creator_id,
    false,
    now()
  )
  on conflict (room_id, user_id)
  do update set
    role = 'host',
    status = 'accepted',
    responded_at = coalesce(
      public.shared_practice_room_members.responded_at,
      now()
    ),
    updated_at = now();

  return v_room_id;
end;
$$;

-- Commons must not identify a generic Together participant who has not opted
-- in. Calendar-backed rooms retain their established Reading House behavior.
create or replace function public.shared_practice_room_card_json(
  p_room public.shared_practice_rooms,
  p_viewer_id uuid default auth.uid()
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_room.id,
    'calendar_id', p_room.calendar_id,
    'source_flow_id', p_room.source_flow_id,
    'shared_flow_id', p_room.shared_flow_id,
    'created_by', case
      when p_room.calendar_id is not null or host_identity.public_identity
        then p_room.created_by
      else null
    end,
    'title', p_room.title,
    'description', p_room.description,
    'flow_key', p_room.flow_key,
    'start_date', p_room.start_date,
    'end_date', p_room.end_date,
    'status', p_room.status,
    'visibility', p_room.visibility,
    'join_policy', p_room.join_policy,
    'request_audience', p_room.request_audience,
    'policy_confirmed_at', p_room.policy_confirmed_at,
    'created_at', p_room.created_at,
    'updated_at', p_room.updated_at,
    'calendar_name', calendar.name,
    'calendar_color', coalesce(calendar.color, flow.color),
    'owner_handle', case
      when p_room.calendar_id is not null or host_identity.public_identity
        then owner_profile.handle
      else null
    end,
    'owner_display_name', case
      when p_room.calendar_id is not null or host_identity.public_identity
        then owner_profile.display_name
      else null
    end,
    'owner_avatar_url', case
      when p_room.calendar_id is not null or host_identity.public_identity
        then owner_profile.avatar_url
      else null
    end,
    'owner_avatar_glyphs', case
      when p_room.calendar_id is not null or host_identity.public_identity
        then owner_profile.avatar_glyphs
      else null
    end,
    'member_count', public.shared_practice_accepted_member_count(p_room.id),
    'pending_request_count', case
      when public.shared_practice_can_manage_room(p_room.id, p_viewer_id)
      then (
        select count(*)::integer
        from public.shared_practice_join_requests request
        where request.room_id = p_room.id
          and request.status = 'pending'
      )
      else 0
    end,
    'viewer_is_member', public.shared_practice_is_room_member(
      p_room.id,
      p_viewer_id
    ),
    'viewer_can_manage', public.shared_practice_can_manage_room(
      p_room.id,
      p_viewer_id
    ),
    'viewer_can_request_join',
      public.shared_practice_can_request_room(p_room.id, p_viewer_id)
      or exists (
        select 1
        from public.shared_practice_join_requests request
        where request.room_id = p_room.id
          and request.requester_id = p_viewer_id
          and request.status = 'pending'
      ),
    'viewer_request_status', (
      select request.status
      from public.shared_practice_join_requests request
      where request.room_id = p_room.id
        and request.requester_id = p_viewer_id
      order by request.created_at desc
      limit 1
    ),
    'likes_count', (
      select count(*)::integer
      from public.shared_practice_room_likes room_like
      where room_like.room_id = p_room.id
    ),
    'liked_by_me', exists (
      select 1
      from public.shared_practice_room_likes room_like
      where room_like.room_id = p_room.id
        and room_like.user_id = p_viewer_id
    ),
    'public_members', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', member.user_id,
            'handle', profile.handle,
            'display_name', profile.display_name,
            'avatar_url', profile.avatar_url,
            'avatar_glyphs', profile.avatar_glyphs
          )
          order by
            case member.role when 'host' then 0 else 1 end,
            member.updated_at,
            member.user_id
        )
        from public.shared_practice_room_members member
        join public.profiles profile on profile.id = member.user_id
        where member.room_id = p_room.id
          and member.status = 'accepted'
          and member.public_identity is true
      ),
      '[]'::jsonb
    )
  )
  from public.profiles owner_profile
  left join public.shared_calendars calendar
    on calendar.id = p_room.calendar_id
   and calendar.deleted_at is null
  left join public.flows flow on flow.id = p_room.source_flow_id
  cross join lateral (
    select coalesce(
      (
        select member.public_identity
        from public.shared_practice_room_members member
        where member.room_id = p_room.id
          and member.user_id = p_room.created_by
          and member.status = 'accepted'
        limit 1
      ),
      false
    ) as public_identity
  ) host_identity
  where owner_profile.id = p_room.created_by;
$$;

-- A block is already disqualifying everywhere Together capability is
-- calculated. Recheck that one existing rule at the moment of approval.
create or replace function public.respond_to_join_request(
  p_request_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_decision text := lower(nullif(btrim(coalesce(p_decision, '')), ''));
  v_request public.shared_practice_join_requests%rowtype;
  v_room public.shared_practice_rooms%rowtype;
  v_member_count integer := 0;
  v_prompt_required boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_decision not in ('approved', 'denied') then
    raise exception 'INVALID_DECISION';
  end if;

  select *
    into v_request
  from public.shared_practice_join_requests request
  where request.id = p_request_id
    and request.status = 'pending'
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  select *
    into v_room
  from public.shared_practice_rooms room
  where room.id = v_request.room_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if not public.shared_practice_can_manage_room(v_room.id, v_uid) then
    raise exception 'ROOM_NOT_MANAGEABLE';
  end if;
  if v_decision = 'approved' and exists (
    select 1
    from public.user_blocks block
    where (
        block.blocker_user_id = v_request.requester_id
        and block.blocked_user_id = v_room.created_by
      )
      or (
        block.blocker_user_id = v_room.created_by
        and block.blocked_user_id = v_request.requester_id
      )
  ) then
    raise exception 'JOIN_REQUEST_NOT_ALLOWED';
  end if;

  update public.shared_practice_join_requests
     set status = v_decision,
         responded_by = v_uid,
         responded_at = now(),
         updated_at = now()
   where id = v_request.id
  returning * into v_request;

  if v_decision = 'approved' then
    if v_room.calendar_id is null then
      insert into public.shared_practice_room_members (
        room_id,
        user_id,
        role,
        status,
        invited_by,
        public_identity,
        responded_at
      )
      values (
        v_room.id,
        v_request.requester_id,
        'member',
        'accepted',
        v_uid,
        false,
        now()
      )
      on conflict (room_id, user_id)
      do update set
        status = 'accepted',
        invited_by = excluded.invited_by,
        responded_at = now(),
        updated_at = now();
    else
      insert into public.shared_calendar_members (
        calendar_id,
        user_id,
        role,
        status,
        invited_by,
        responded_at
      )
      values (
        v_room.calendar_id,
        v_request.requester_id,
        'viewer',
        'accepted',
        v_uid,
        now()
      )
      on conflict (calendar_id, user_id)
      do update set
        role = case
          when public.shared_calendar_members.role = 'owner'
            then public.shared_calendar_members.role
          else 'viewer'
        end,
        status = 'accepted',
        invited_by = coalesce(
          public.shared_calendar_members.invited_by,
          v_uid
        ),
        responded_at = now(),
        updated_at = now();
    end if;
  end if;

  if v_room.calendar_id is null then
    select count(*)::integer
      into v_member_count
    from public.shared_practice_room_members member
    where member.room_id = v_room.id
      and member.status = 'accepted';
  else
    select count(*)::integer
      into v_member_count
    from public.shared_calendar_members member
    where member.calendar_id = v_room.calendar_id
      and member.status = 'accepted';
  end if;

  v_prompt_required :=
    v_decision = 'approved'
    and v_member_count = 2
    and v_room.policy_confirmed_at is null;

  return jsonb_build_object(
    'id', v_request.id,
    'room_id', v_request.room_id,
    'requester_id', v_request.requester_id,
    'status', v_request.status,
    'responded_by', v_request.responded_by,
    'responded_at', v_request.responded_at,
    'created_at', v_request.created_at,
    'updated_at', v_request.updated_at,
    'member_count', v_member_count,
    'policy_prompt_required', v_prompt_required
  );
end;
$$;

-- Touch only the creator's matching generic Together room when its canonical
-- event position changes. Members can then refresh from one room-scoped event.
create or replace function private.touch_together_rooms_for_host_event()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.shared_practice_rooms room
       set updated_at = clock_timestamp()
      from public.flows flow
     where room.calendar_id is null
       and room.status = 'active'
       and room.created_by = old.user_id
       and room.source_flow_id = flow.id
       and flow.user_id = old.user_id
       and (
         old.flow_local_id = flow.id
         or public.user_event_matches_flow(
           flow.id,
           old.flow_local_id,
           old.client_event_id,
           old.detail,
           old.action_id,
           flow.ai_metadata
         )
       );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    update public.shared_practice_rooms room
       set updated_at = clock_timestamp()
      from public.flows flow
     where room.calendar_id is null
       and room.status = 'active'
       and room.created_by = new.user_id
       and room.source_flow_id = flow.id
       and flow.user_id = new.user_id
       and (
         new.flow_local_id = flow.id
         or public.user_event_matches_flow(
           flow.id,
           new.flow_local_id,
           new.client_event_id,
           new.detail,
           new.action_id,
           flow.ai_metadata
         )
       );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_together_rooms_for_host_event
on public.user_events;
create trigger trg_touch_together_rooms_for_host_event
after insert or delete or update of
  user_id,
  flow_local_id,
  client_event_id,
  detail,
  action_id,
  category,
  behavior_payload,
  starts_at,
  ends_at
on public.user_events
for each row
execute function private.touch_together_rooms_for_host_event();

do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_practice_rooms'
  ) then
    alter publication supabase_realtime add table public.shared_practice_rooms;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_practice_room_members'
  ) then
    alter publication supabase_realtime
      add table public.shared_practice_room_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_practice_join_requests'
  ) then
    alter publication supabase_realtime
      add table public.shared_practice_join_requests;
  end if;
end;
$do$;

revoke all on function private.ensure_together_overlay_for_flow(bigint, uuid)
from public;
revoke all on function private.touch_together_rooms_for_host_event()
from public;
revoke all on function public.shared_practice_room_card_json(
  public.shared_practice_rooms,
  uuid
) from public;
revoke all on function public.respond_to_join_request(uuid, text) from public;
grant execute on function public.respond_to_join_request(uuid, text)
to authenticated;

notify pgrst, 'reload schema';

commit;
