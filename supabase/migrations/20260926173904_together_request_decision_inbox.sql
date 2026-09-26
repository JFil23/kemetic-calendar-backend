alter table public.shared_practice_join_requests
  add column if not exists requester_seen_at timestamptz;

create or replace function private.reset_together_request_decision_seen()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved', 'denied') then
    new.requester_seen_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_together_request_decision_seen
on public.shared_practice_join_requests;
create trigger trg_reset_together_request_decision_seen
before update of status on public.shared_practice_join_requests
for each row
execute function private.reset_together_request_decision_seen();

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
            and public.users_are_mutual_follows(
              target.user_id,
              p_viewer_id
            )
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

create or replace function public.get_together_request_decisions(
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
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(decision_row) order by responded_at)
      from (
        select
          request.id,
          request.room_id,
          request.status,
          request.responded_at,
          request.created_at,
          room.title,
          room.source_flow_id,
          room.created_by as host_id,
          host.handle as host_handle,
          host.display_name as host_display_name,
          host.avatar_url as host_avatar_url
        from public.shared_practice_join_requests request
        join public.shared_practice_rooms room on room.id = request.room_id
        left join public.profiles host on host.id = room.created_by
        where request.requester_id = v_uid
          and request.status in ('approved', 'denied')
          and request.requester_seen_at is null
        order by request.responded_at asc nulls last
        limit v_limit
      ) decision_row
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.mark_together_request_decision_seen(
  p_request_id uuid
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

  update public.shared_practice_join_requests request
     set requester_seen_at = now(),
         updated_at = now()
   where request.id = p_request_id
     and request.requester_id = v_uid
     and request.status in ('approved', 'denied')
     and request.requester_seen_at is null;

  if not found then
    raise exception 'REQUEST_DECISION_NOT_FOUND';
  end if;
end;
$$;

revoke all on function private.together_flow_post_capability(uuid, uuid)
from public;
revoke all on function private.reset_together_request_decision_seen()
from public;
revoke all on function public.get_together_request_decisions(integer)
from public;
revoke all on function public.mark_together_request_decision_seen(uuid)
from public;

grant execute on function public.get_together_request_decisions(integer)
to authenticated;
grant execute on function public.mark_together_request_decision_seen(uuid)
to authenticated;

notify pgrst, 'reload schema';
