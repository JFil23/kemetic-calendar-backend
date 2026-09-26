begin;

-- Together is a social overlay on the creator's existing flow. Legacy and
-- Reading House rooms retain their shared-calendar identity; new generic
-- Together rooms deliberately have no calendar and never copy a flow/event.
alter table public.shared_practice_rooms
  alter column calendar_id drop not null;

alter table public.shared_practice_rooms
  add column if not exists request_audience text not null default 'creator_friends',
  add column if not exists policy_confirmed_at timestamptz;

alter table public.shared_practice_rooms
  drop constraint if exists shared_practice_rooms_request_audience_check;

alter table public.shared_practice_rooms
  add constraint shared_practice_rooms_request_audience_check
  check (
    request_audience in (
      'nobody',
      'creator_friends',
      'participant_friends',
      'anyone'
    )
  );

create unique index if not exists shared_practice_rooms_active_overlay_flow_idx
  on public.shared_practice_rooms (created_by, source_flow_id)
  where status = 'active' and calendar_id is null;

create table if not exists public.shared_practice_room_members (
  room_id uuid not null references public.shared_practice_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('host', 'member')),
  status text not null default 'invited'
    check (status in ('invited', 'accepted', 'declined', 'removed')),
  invited_by uuid references public.profiles(id) on delete set null,
  public_identity boolean not null default false,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists shared_practice_room_members_user_status_idx
  on public.shared_practice_room_members (user_id, status, updated_at desc);

create index if not exists shared_practice_room_members_room_status_idx
  on public.shared_practice_room_members (room_id, status, updated_at desc);

drop trigger if exists trg_touch_shared_practice_room_members_updated_at
on public.shared_practice_room_members;
create trigger trg_touch_shared_practice_room_members_updated_at
before update on public.shared_practice_room_members
for each row execute function public.touch_shared_practice_updated_at();

alter table public.shared_practice_room_members enable row level security;
revoke all on table public.shared_practice_room_members from anon, authenticated;
grant select on table public.shared_practice_room_members to authenticated;

create or replace function public.users_are_mutual_follows(
  p_first_user_id uuid,
  p_second_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_first_user_id is not null
    and p_second_user_id is not null
    and p_first_user_id <> p_second_user_id
    and exists (
      select 1
      from public.follows first_to_second
      where first_to_second.follower_id = p_first_user_id
        and first_to_second.followee_id = p_second_user_id
    )
    and exists (
      select 1
      from public.follows second_to_first
      where second_to_first.follower_id = p_second_user_id
        and second_to_first.followee_id = p_first_user_id
    )
    and not exists (
      select 1
      from public.user_blocks block
      where (
          block.blocker_user_id = p_first_user_id
          and block.blocked_user_id = p_second_user_id
        )
        or (
          block.blocker_user_id = p_second_user_id
          and block.blocked_user_id = p_first_user_id
        )
    );
$$;

create or replace function public.shared_practice_is_room_member(
  p_room_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
    select 1
    from public.shared_practice_rooms room
    where room.id = p_room_id
      and (
        room.created_by = p_user_id
        or exists (
          select 1
          from public.shared_practice_room_members member
          where member.room_id = room.id
            and member.user_id = p_user_id
            and member.status = 'accepted'
        )
        or (
          room.calendar_id is not null
          and public.shared_practice_is_calendar_member(
            room.calendar_id,
            p_user_id
          )
        )
      )
  );
$$;

create or replace function public.shared_practice_can_manage_room(
  p_room_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
    select 1
    from public.shared_practice_rooms room
    where room.id = p_room_id
      and (
        room.created_by = p_user_id
        or exists (
          select 1
          from public.shared_practice_room_members member
          where member.room_id = room.id
            and member.user_id = p_user_id
            and member.status = 'accepted'
            and member.role = 'host'
        )
        or (
          room.calendar_id is not null
          and exists (
            select 1
            from public.shared_calendars calendar
            where calendar.id = room.calendar_id
              and calendar.deleted_at is null
              and (
                calendar.owner_id = p_user_id
                or exists (
                  select 1
                  from public.shared_calendar_members member
                  where member.calendar_id = calendar.id
                    and member.user_id = p_user_id
                    and member.status = 'accepted'
                    and member.role = 'owner'
                )
              )
          )
        )
      )
  );
$$;

create or replace function public.shared_practice_can_read_room(
  p_room_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
    select 1
    from public.shared_practice_rooms room
    where room.id = p_room_id
      and room.status = 'active'
      and (
        room.visibility = 'public'
        or public.shared_practice_is_room_member(room.id, p_user_id)
      )
  );
$$;

create or replace function public.shared_practice_can_request_room(
  p_room_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1
    from public.shared_practice_rooms room
    where room.id = p_room_id
      and room.status = 'active'
      and room.visibility = 'public'
      and room.created_by <> p_user_id
      and not public.shared_practice_is_room_member(room.id, p_user_id)
      and not exists (
        select 1
        from public.user_blocks block
        where (
            block.blocker_user_id = p_user_id
            and block.blocked_user_id = room.created_by
          )
          or (
            block.blocker_user_id = room.created_by
            and block.blocked_user_id = p_user_id
          )
      )
      and case room.request_audience
        when 'anyone' then true
        when 'creator_friends' then public.users_are_mutual_follows(
          p_user_id,
          room.created_by
        )
        when 'participant_friends' then exists (
          select 1
          from public.shared_practice_room_members participant
          where participant.room_id = room.id
            and participant.status = 'accepted'
            and public.users_are_mutual_follows(
              p_user_id,
              participant.user_id
            )
        )
        else false
      end
  );
$$;

drop policy if exists shared_practice_room_members_select_visible
on public.shared_practice_room_members;
create policy shared_practice_room_members_select_visible
on public.shared_practice_room_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.shared_practice_can_manage_room(room_id, (select auth.uid()))
  or (
    status = 'accepted'
    and (
      public.shared_practice_is_room_member(room_id, (select auth.uid()))
      or (
        public_identity is true
        and exists (
          select 1
          from public.shared_practice_rooms room
          where room.id = shared_practice_room_members.room_id
            and room.status = 'active'
            and room.visibility = 'public'
        )
      )
    )
  )
);

drop policy if exists shared_practice_rooms_select_visible
on public.shared_practice_rooms;
create policy shared_practice_rooms_select_visible
on public.shared_practice_rooms
for select
to authenticated
using (public.shared_practice_can_read_room(id, (select auth.uid())));

-- Requests must go through the server-authoritative RPCs below. Direct client
-- writes would let a caller bypass mutual-follow and request-audience checks.
revoke insert, update, delete
on table public.shared_practice_join_requests
from authenticated;
grant select on table public.shared_practice_join_requests to authenticated;

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
    true,
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

create or replace function private.together_flow_post_capability(
  p_flow_post_id uuid,
  p_viewer_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with target as (
    select post.id, post.user_id, post.flow_id
    from public.flow_posts post
    join public.flows flow
      on flow.id = post.flow_id
     and flow.user_id = post.user_id
     and flow.active is true
     and coalesce(flow.is_hidden, false) is false
    where post.id = p_flow_post_id
      and coalesce(post.is_hidden, false) is false
  ),
  room as (
    select practice.id
    from target
    join public.shared_practice_rooms practice
      on practice.source_flow_id = target.flow_id
     and practice.created_by = target.user_id
     and practice.calendar_id is null
     and practice.status = 'active'
    order by practice.created_at desc
    limit 1
  ),
  request_state as (
    select request.status
    from room
    join public.shared_practice_join_requests request
      on request.room_id = room.id
     and request.requester_id = p_viewer_id
    order by request.created_at desc
    limit 1
  ),
  accepted as (
    select count(*)::integer as member_count
    from room
    join public.shared_practice_room_members member
      on member.room_id = room.id
     and member.status = 'accepted'
  )
  select jsonb_build_object(
    'viewer_can_request_together',
      coalesce((select member_count from accepted), 1) < 2
      and (
        coalesce((select status = 'pending' from request_state), false)
        or exists (
          select 1
          from target
          where p_viewer_id is not null
            and target.user_id <> p_viewer_id
            and public.users_are_mutual_follows(target.user_id, p_viewer_id)
            and not exists (
              select 1
              from room
              join public.shared_practice_room_members member
                on member.room_id = room.id
               and member.user_id = p_viewer_id
               and member.status in ('accepted', 'invited')
            )
        )
      ),
    'viewer_together_request_status',
      (select status from request_state),
    'together_room_id',
      (select id from room)
  );
$$;

create or replace function public.get_profile_feed_together_cards(
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      case
        when item ->> 'post_type' = 'flow' then
          item || private.together_flow_post_capability(
            (item ->> 'id')::uuid,
            (select auth.uid())
          )
        else item
      end
      order by ordinal
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    public.get_profile_feed_cards(p_limit, p_offset)
  ) with ordinality as feed(item, ordinal);
$$;

create or replace function public.request_together_on_flow_post(
  p_flow_post_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.flow_posts%rowtype;
  v_room_id uuid;
  v_request public.shared_practice_join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_post
  from public.flow_posts post
  where post.id = p_flow_post_id
    and coalesce(post.is_hidden, false) is false
  for share;

  if not found or v_post.flow_id is null then
    raise exception 'FLOW_POST_NOT_AVAILABLE';
  end if;
  if v_post.user_id = v_uid then
    raise exception 'CANNOT_REQUEST_OWN_FLOW';
  end if;
  if not public.users_are_mutual_follows(v_uid, v_post.user_id) then
    raise exception 'MUTUAL_FOLLOW_REQUIRED';
  end if;

  v_room_id := private.ensure_together_overlay_for_flow(
    v_post.flow_id,
    v_post.user_id
  );

  if exists (
    select 1
    from public.shared_practice_room_members member
    where member.room_id = v_room_id
      and member.user_id = v_uid
      and member.status in ('accepted', 'invited')
  ) then
    raise exception 'ALREADY_MEMBER_OR_INVITED';
  end if;

  if (
    select count(*)
    from public.shared_practice_room_members member
    where member.room_id = v_room_id
      and member.status = 'accepted'
  ) >= 2 then
    raise exception 'FLOW_ALREADY_GROUP';
  end if;

  insert into public.shared_practice_join_requests (
    room_id,
    requester_id,
    message,
    status
  )
  values (v_room_id, v_uid, null, 'pending')
  on conflict (room_id, requester_id) where status = 'pending'
  do update set updated_at = now()
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

create or replace function public.cancel_together_request(
  p_flow_post_id uuid
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
    from public.shared_practice_rooms room,
         public.flow_posts post
   where post.id = p_flow_post_id
     and room.source_flow_id = post.flow_id
     and room.created_by = post.user_id
     and room.calendar_id is null
     and room.status = 'active'
     and request.room_id = room.id
     and request.requester_id = v_uid
     and request.status = 'pending'
  returning request.* into v_request;

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

create or replace function public.create_together_overlay_for_flow(
  p_flow_id bigint,
  p_invitee_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_invitee_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_room_id := private.ensure_together_overlay_for_flow(p_flow_id, v_uid);

  foreach v_invitee_id in array coalesce(p_invitee_ids, '{}'::uuid[])
  loop
    if v_invitee_id is null or v_invitee_id = v_uid then
      continue;
    end if;
    if exists (
      select 1
      from public.user_blocks block
      where (
          block.blocker_user_id = v_uid
          and block.blocked_user_id = v_invitee_id
        )
        or (
          block.blocker_user_id = v_invitee_id
          and block.blocked_user_id = v_uid
        )
    ) then
      continue;
    end if;

    insert into public.shared_practice_room_members (
      room_id,
      user_id,
      role,
      status,
      invited_by,
      public_identity
    )
    select
      v_room_id,
      profile.id,
      'member',
      'invited',
      v_uid,
      false
    from public.profiles profile
    where profile.id = v_invitee_id
      and coalesce(profile.allow_incoming_shares, true) = true
    on conflict (room_id, user_id)
    do update set
      status = case
        when public.shared_practice_room_members.status = 'accepted'
          then 'accepted'
        else 'invited'
      end,
      invited_by = excluded.invited_by,
      responded_at = case
        when public.shared_practice_room_members.status = 'accepted'
          then public.shared_practice_room_members.responded_at
        else null
      end,
      updated_at = now();
  end loop;

  return jsonb_build_object(
    'room_id', v_room_id,
    'source_flow_id', p_flow_id,
    'invited_user_ids', coalesce(
      (
        select jsonb_agg(member.user_id order by member.created_at)
        from public.shared_practice_room_members member
        where member.room_id = v_room_id
          and member.status = 'invited'
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.respond_to_together_invitation(
  p_room_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.shared_practice_room_members%rowtype;
  v_member_count integer;
  v_prompt_required boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_practice_room_members member
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now(),
         updated_at = now()
   where member.room_id = p_room_id
     and member.user_id = v_uid
     and member.status = 'invited'
  returning * into v_member;

  if not found then
    raise exception 'INVITATION_NOT_FOUND';
  end if;

  select count(*)::integer
    into v_member_count
  from public.shared_practice_room_members member
  where member.room_id = p_room_id
    and member.status = 'accepted';

  select p_accept and v_member_count = 2 and room.policy_confirmed_at is null
    into v_prompt_required
  from public.shared_practice_rooms room
  where room.id = p_room_id;

  return jsonb_build_object(
    'room_id', v_member.room_id,
    'user_id', v_member.user_id,
    'status', v_member.status,
    'member_count', v_member_count,
    'policy_prompt_required', coalesce(v_prompt_required, false)
  );
end;
$$;

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

create or replace function public.set_shared_practice_access(
  p_room_id uuid,
  p_visibility text,
  p_request_audience text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_visibility text := lower(nullif(btrim(coalesce(p_visibility, '')), ''));
  v_request_audience text := lower(
    nullif(btrim(coalesce(p_request_audience, '')), '')
  );
  v_room public.shared_practice_rooms%rowtype;
  v_member_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.shared_practice_can_manage_room(p_room_id, v_uid) then
    raise exception 'ROOM_NOT_MANAGEABLE';
  end if;
  if v_visibility not in ('private', 'public') then
    raise exception 'INVALID_VISIBILITY';
  end if;
  if v_request_audience not in (
    'nobody',
    'creator_friends',
    'participant_friends',
    'anyone'
  ) then
    raise exception 'INVALID_REQUEST_AUDIENCE';
  end if;

  select count(*)::integer
    into v_member_count
  from public.shared_practice_room_members member
  where member.room_id = p_room_id
    and member.status = 'accepted';

  if v_member_count = 0 then
    select count(*)::integer
      into v_member_count
    from public.shared_practice_rooms room
    join public.shared_calendar_members member
      on member.calendar_id = room.calendar_id
     and member.status = 'accepted'
    where room.id = p_room_id;
  end if;

  if v_visibility = 'public' and v_member_count < 2 then
    raise exception 'GROUP_REQUIRED_FOR_PUBLIC_VISIBILITY';
  end if;

  update public.shared_practice_rooms room
     set visibility = v_visibility,
         request_audience = v_request_audience,
         join_policy = case
           when v_request_audience = 'nobody' then 'closed'
           else 'owner_approval'
         end,
         policy_confirmed_at = now(),
         updated_at = now()
   where room.id = p_room_id
  returning * into v_room;

  return jsonb_build_object(
    'id', v_room.id,
    'visibility', v_room.visibility,
    'request_audience', v_room.request_audience,
    'member_count', v_member_count,
    'policy_confirmed_at', v_room.policy_confirmed_at
  );
end;
$$;

create or replace function public.set_shared_practice_public_identity(
  p_room_id uuid,
  p_public boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.shared_practice_room_members%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_practice_room_members member
     set public_identity = coalesce(p_public, false),
         updated_at = now()
   where member.room_id = p_room_id
     and member.user_id = v_uid
     and member.status = 'accepted'
  returning * into v_member;

  if not found then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;

  return jsonb_build_object(
    'room_id', v_member.room_id,
    'user_id', v_member.user_id,
    'public_identity', v_member.public_identity
  );
end;
$$;

create or replace function public.get_together_inbox(
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_requests jsonb := '[]'::jsonb;
  v_invitations jsonb := '[]'::jsonb;
  v_policy_prompts jsonb := '[]'::jsonb;
  v_active_rooms jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(request_row) order by created_at), '[]'::jsonb)
    into v_requests
  from (
    select
      request.id,
      request.room_id,
      request.requester_id,
      request.status,
      request.created_at,
      request.updated_at,
      room.title,
      room.source_flow_id,
      profile.handle as requester_handle,
      profile.display_name as requester_display_name,
      profile.avatar_url as requester_avatar_url,
      profile.avatar_glyphs as requester_avatar_glyphs
    from public.shared_practice_join_requests request
    join public.shared_practice_rooms room on room.id = request.room_id
    join public.profiles profile on profile.id = request.requester_id
    where request.status = 'pending'
      and public.shared_practice_can_manage_room(room.id, v_uid)
    order by request.created_at asc
    limit v_limit
  ) request_row;

  select coalesce(jsonb_agg(to_jsonb(invite_row) order by created_at), '[]'::jsonb)
    into v_invitations
  from (
    select
      member.room_id,
      member.user_id,
      member.invited_by,
      member.status,
      member.created_at,
      member.updated_at,
      room.title,
      room.source_flow_id,
      host.handle as host_handle,
      host.display_name as host_display_name,
      host.avatar_url as host_avatar_url,
      host.avatar_glyphs as host_avatar_glyphs
    from public.shared_practice_room_members member
    join public.shared_practice_rooms room on room.id = member.room_id
    join public.profiles host on host.id = room.created_by
    where member.user_id = v_uid
      and member.status = 'invited'
      and room.status = 'active'
    order by member.created_at asc
    limit v_limit
  ) invite_row;

  select coalesce(jsonb_agg(to_jsonb(prompt_row) order by joined_at), '[]'::jsonb)
    into v_policy_prompts
  from (
    select
      room.id as room_id,
      room.title,
      room.source_flow_id,
      room.visibility,
      room.request_audience,
      latest.user_id as joined_user_id,
      latest.responded_at as joined_at,
      profile.handle as joined_handle,
      profile.display_name as joined_display_name,
      profile.avatar_url as joined_avatar_url,
      member_counts.member_count
    from public.shared_practice_rooms room
    join lateral (
      select count(*)::integer as member_count
      from public.shared_practice_room_members member
      where member.room_id = room.id
        and member.status = 'accepted'
    ) member_counts on true
    left join lateral (
      select member.user_id, member.responded_at
      from public.shared_practice_room_members member
      where member.room_id = room.id
        and member.status = 'accepted'
        and member.user_id <> room.created_by
      order by member.responded_at desc nulls last, member.updated_at desc
      limit 1
    ) latest on true
    left join public.profiles profile on profile.id = latest.user_id
    where room.created_by = v_uid
      and room.status = 'active'
      and room.policy_confirmed_at is null
      and member_counts.member_count >= 2
    order by latest.responded_at asc nulls last
    limit v_limit
  ) prompt_row;

  select coalesce(
    jsonb_agg(to_jsonb(active_room) order by updated_at desc),
    '[]'::jsonb
  ) into v_active_rooms
  from (
    select
      room.id as room_id,
      room.title,
      room.source_flow_id,
      room.visibility,
      room.request_audience,
      room.created_by,
      room.updated_at,
      host.handle as host_handle,
      host.display_name as host_display_name,
      host.avatar_url as host_avatar_url,
      member_counts.member_count
    from public.shared_practice_rooms room
    join lateral (
      select count(*)::integer as member_count
      from public.shared_practice_room_members member
      where member.room_id = room.id
        and member.status = 'accepted'
    ) member_counts on true
    left join public.profiles host on host.id = room.created_by
    where room.calendar_id is null
      and room.status = 'active'
      and member_counts.member_count >= 2
      and (
        room.created_by = v_uid
        or exists (
          select 1
          from public.shared_practice_room_members member
          where member.room_id = room.id
            and member.user_id = v_uid
            and member.status = 'accepted'
        )
      )
    order by room.updated_at desc
    limit v_limit
  ) active_room;

  return jsonb_build_object(
    'join_requests', v_requests,
    'invitations', v_invitations,
    'policy_prompts', v_policy_prompts,
    'active_rooms', v_active_rooms
  );
end;
$$;

revoke all on function public.users_are_mutual_follows(uuid, uuid) from public;
revoke all on function public.shared_practice_is_room_member(uuid, uuid) from public;
revoke all on function public.shared_practice_can_manage_room(uuid, uuid) from public;
revoke all on function public.shared_practice_can_read_room(uuid, uuid) from public;
revoke all on function public.shared_practice_can_request_room(uuid, uuid) from public;
revoke all on function private.ensure_together_overlay_for_flow(bigint, uuid) from public;
revoke all on function private.together_flow_post_capability(uuid, uuid) from public;
revoke all on function public.get_profile_feed_together_cards(integer, integer) from public;
revoke all on function public.request_together_on_flow_post(uuid) from public;
revoke all on function public.cancel_together_request(uuid) from public;
revoke all on function public.create_together_overlay_for_flow(bigint, uuid[]) from public;
revoke all on function public.respond_to_together_invitation(uuid, boolean) from public;
revoke all on function public.respond_to_join_request(uuid, text) from public;
revoke all on function public.set_shared_practice_access(uuid, text, text) from public;
revoke all on function public.set_shared_practice_public_identity(uuid, boolean) from public;
revoke all on function public.get_together_inbox(integer) from public;

grant execute on function public.shared_practice_is_room_member(uuid, uuid) to authenticated;
grant execute on function public.shared_practice_can_manage_room(uuid, uuid) to authenticated;
grant execute on function public.shared_practice_can_read_room(uuid, uuid) to authenticated;
grant execute on function public.get_profile_feed_together_cards(integer, integer) to authenticated;
grant execute on function public.request_together_on_flow_post(uuid) to authenticated;
grant execute on function public.cancel_together_request(uuid) to authenticated;
grant execute on function public.create_together_overlay_for_flow(bigint, uuid[]) to authenticated;
grant execute on function public.respond_to_together_invitation(uuid, boolean) to authenticated;
grant execute on function public.respond_to_join_request(uuid, text) to authenticated;
grant execute on function public.set_shared_practice_access(uuid, text, text) to authenticated;
grant execute on function public.set_shared_practice_public_identity(uuid, boolean) to authenticated;
grant execute on function public.get_together_inbox(integer) to authenticated;

comment on table public.shared_practice_room_members is
  'Membership for Together overlays that remain attached to the creator original flow. No flow or calendar is forked.';
comment on column public.shared_practice_rooms.request_audience is
  'Who may submit a host-approved join request; independent of Commons visibility.';
comment on function public.get_profile_feed_together_cards(integer, integer) is
  'Canonical profile-feed cards enriched with server-authoritative mutual-follow Together capability and request state.';

notify pgrst, 'reload schema';

commit;
