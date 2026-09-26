begin;

create table if not exists public.shared_practice_room_likes (
  room_id uuid not null references public.shared_practice_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists shared_practice_room_likes_created_idx
  on public.shared_practice_room_likes (room_id, created_at desc);

alter table public.shared_practice_room_likes enable row level security;
revoke all on table public.shared_practice_room_likes from anon, authenticated;
grant select on table public.shared_practice_room_likes to authenticated;

create or replace function public.shared_practice_accepted_member_count(
  p_room_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select case
        when room.calendar_id is null then (
          select count(*)::integer
          from public.shared_practice_room_members member
          where member.room_id = room.id
            and member.status = 'accepted'
        )
        else (
          select count(*)::integer
          from public.shared_calendar_members member
          where member.calendar_id = room.calendar_id
            and member.status = 'accepted'
        )
      end
      from public.shared_practice_rooms room
      where room.id = p_room_id
    ),
    0
  );
$$;

drop policy if exists shared_practice_room_likes_select_public_group
on public.shared_practice_room_likes;
create policy shared_practice_room_likes_select_public_group
on public.shared_practice_room_likes
for select
to authenticated
using (
  exists (
    select 1
    from public.shared_practice_rooms room
    where room.id = shared_practice_room_likes.room_id
      and room.status = 'active'
      and room.visibility = 'public'
      and public.shared_practice_accepted_member_count(room.id) >= 2
  )
);

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
    'created_by', p_room.created_by,
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
    'owner_handle', owner_profile.handle,
    'owner_display_name', owner_profile.display_name,
    'owner_avatar_url', owner_profile.avatar_url,
    'owner_avatar_glyphs', owner_profile.avatar_glyphs,
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
  where owner_profile.id = p_room.created_by;
$$;

create or replace function public.request_join_shared_practice(
  p_room_id uuid,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.shared_practice_join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Kept only for backward-compatible RPC shape. Together requests never
  -- carry a message; the interaction is intentionally one tap.
  perform p_message;

  select *
    into v_request
  from public.shared_practice_join_requests request
  where request.room_id = p_room_id
    and request.requester_id = v_uid
    and request.status = 'pending'
  order by request.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'id', v_request.id,
      'room_id', v_request.room_id,
      'requester_id', v_request.requester_id,
      'status', v_request.status,
      'created_at', v_request.created_at,
      'updated_at', v_request.updated_at
    );
  end if;

  if not public.shared_practice_can_request_room(p_room_id, v_uid) then
    raise exception 'JOIN_REQUEST_NOT_ALLOWED';
  end if;

  insert into public.shared_practice_join_requests (
    room_id,
    requester_id,
    message,
    status
  )
  values (p_room_id, v_uid, null, 'pending')
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'room_id', v_request.room_id,
    'requester_id', v_request.requester_id,
    'status', v_request.status,
    'created_at', v_request.created_at,
    'updated_at', v_request.updated_at
  );
end;
$$;

create or replace function public.cancel_join_shared_practice(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.shared_practice_join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_practice_join_requests request
     set status = 'cancelled',
         responded_by = v_uid,
         responded_at = now(),
         updated_at = now()
   where request.room_id = p_room_id
     and request.requester_id = v_uid
     and request.status = 'pending'
  returning * into v_request;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'room_id', v_request.room_id,
    'requester_id', v_request.requester_id,
    'status', v_request.status,
    'updated_at', v_request.updated_at
  );
end;
$$;

create or replace function public.toggle_shared_practice_room_like(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_liked boolean;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.shared_practice_rooms room
    where room.id = p_room_id
      and room.status = 'active'
      and room.visibility = 'public'
      and public.shared_practice_accepted_member_count(room.id) >= 2
  ) then
    raise exception 'PUBLIC_GROUP_NOT_FOUND';
  end if;

  delete from public.shared_practice_room_likes room_like
  where room_like.room_id = p_room_id
    and room_like.user_id = v_uid;

  if found then
    v_liked := false;
  else
    insert into public.shared_practice_room_likes (room_id, user_id)
    values (p_room_id, v_uid);
    v_liked := true;
  end if;

  select count(*)::integer
    into v_count
  from public.shared_practice_room_likes room_like
  where room_like.room_id = p_room_id;

  return jsonb_build_object(
    'room_id', p_room_id,
    'liked_by_me', v_liked,
    'likes_count', v_count
  );
end;
$$;

create or replace function public.get_commons_together_home_cards(
  p_local_date date default current_date,
  p_question_id text default '',
  p_question_text text default '',
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 24);
  v_home jsonb;
  v_my_groups jsonb := '[]'::jsonb;
  v_public_groups jsonb := '[]'::jsonb;
  v_public_group_count integer := 0;
  v_public_group_label text := '0';
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_home := public.get_commons_home_cards(
    p_local_date,
    p_question_id,
    p_question_text,
    p_limit
  );

  select count(*)::integer
    into v_public_group_count
  from public.shared_practice_rooms room
  where room.status = 'active'
    and room.visibility = 'public'
    and public.shared_practice_accepted_member_count(room.id) >= 2
    and not exists (
      select 1
      from public.user_blocks block
      where (
          block.blocker_user_id = v_uid
          and block.blocked_user_id = room.created_by
        )
        or (
          block.blocker_user_id = room.created_by
          and block.blocked_user_id = v_uid
        )
    );

  select coalesce(
      jsonb_agg(
        public.shared_practice_room_card_json(room, v_uid)
        order by room.updated_at desc
      ),
      '[]'::jsonb
    )
    into v_my_groups
  from (
    select room.*
    from public.shared_practice_rooms room
    where room.status = 'active'
      and room.visibility = 'public'
      and public.shared_practice_accepted_member_count(room.id) >= 2
      and public.shared_practice_is_room_member(room.id, v_uid)
    order by room.updated_at desc
    limit v_limit
  ) room;

  select coalesce(
      jsonb_agg(
        public.shared_practice_room_card_json(room, v_uid)
        order by room.updated_at desc
      ),
      '[]'::jsonb
    )
    into v_public_groups
  from (
    select room.*
    from public.shared_practice_rooms room
    where room.status = 'active'
      and room.visibility = 'public'
      and public.shared_practice_accepted_member_count(room.id) >= 2
      and not public.shared_practice_is_room_member(room.id, v_uid)
      and not exists (
        select 1
        from public.user_blocks block
        where (
            block.blocker_user_id = v_uid
            and block.blocked_user_id = room.created_by
          )
          or (
            block.blocker_user_id = room.created_by
            and block.blocked_user_id = v_uid
          )
      )
    order by room.updated_at desc
    limit v_limit
  ) room;

  v_public_group_label := case
    when v_public_group_count >= 3 then v_public_group_count::text
    when v_public_group_count > 0 then 'a few'
    else '0'
  end;

  v_home := jsonb_set(v_home, '{my_shared_practices}', v_my_groups, true);
  v_home := jsonb_set(
    v_home,
    '{public_shared_practices}',
    v_public_groups,
    true
  );
  v_home := jsonb_set(
    v_home,
    '{rhythm,public_rooms_open_label}',
    to_jsonb(v_public_group_label),
    true
  );
  return v_home;
end;
$$;

revoke all on function public.shared_practice_accepted_member_count(uuid) from public;
revoke all on function public.shared_practice_room_card_json(public.shared_practice_rooms, uuid) from public;
revoke all on function public.request_join_shared_practice(uuid, text) from public;
revoke all on function public.cancel_join_shared_practice(uuid) from public;
revoke all on function public.toggle_shared_practice_room_like(uuid) from public;
revoke all on function public.get_commons_together_home_cards(date, text, text, integer) from public;

grant execute on function public.shared_practice_accepted_member_count(uuid) to authenticated;
grant execute on function public.request_join_shared_practice(uuid, text) to authenticated;
grant execute on function public.cancel_join_shared_practice(uuid) to authenticated;
grant execute on function public.toggle_shared_practice_room_like(uuid) to authenticated;
grant execute on function public.get_commons_together_home_cards(date, text, text, integer) to authenticated;

comment on function public.get_commons_together_home_cards(date, text, text, integer) is
  'Commons payload whose shared-practice sections contain only public active groups with at least two accepted members. Visibility and join eligibility are independent.';

notify pgrst, 'reload schema';

commit;
