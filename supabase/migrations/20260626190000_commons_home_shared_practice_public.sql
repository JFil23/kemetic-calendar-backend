alter table public.shared_practice_rooms
  add column if not exists description text,
  add column if not exists visibility text not null default 'private',
  add column if not exists join_policy text not null default 'owner_approval';

do $do$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shared_practice_rooms_visibility_check'
      and conrelid = 'public.shared_practice_rooms'::regclass
  ) then
    alter table public.shared_practice_rooms
      add constraint shared_practice_rooms_visibility_check
      check (visibility in ('private', 'unlisted', 'public'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'shared_practice_rooms_join_policy_check'
      and conrelid = 'public.shared_practice_rooms'::regclass
  ) then
    alter table public.shared_practice_rooms
      add constraint shared_practice_rooms_join_policy_check
      check (join_policy in ('owner_approval', 'open', 'closed'));
  end if;
end;
$do$;

alter table public.shared_practice_entries
  drop constraint if exists shared_practice_entries_visibility_check;

alter table public.shared_practice_entries
  add constraint shared_practice_entries_visibility_check
  check (visibility in ('private', 'shared_with_calendar', 'public'));

create index if not exists shared_practice_rooms_public_idx
  on public.shared_practice_rooms (visibility, status, updated_at desc)
  where visibility = 'public' and status = 'active';

create table if not exists public.shared_practice_join_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_practice_rooms(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'cancelled')),
  responded_by uuid references auth.users(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_practice_join_requests_message_len
    check (message is null or char_length(message) <= 500)
);

create unique index if not exists shared_practice_join_requests_pending_unique
  on public.shared_practice_join_requests(room_id, requester_id)
  where status = 'pending';

create index if not exists shared_practice_join_requests_room_status_idx
  on public.shared_practice_join_requests(room_id, status, created_at desc);

create index if not exists shared_practice_join_requests_requester_idx
  on public.shared_practice_join_requests(requester_id, created_at desc);

drop trigger if exists trg_touch_shared_practice_join_requests_updated_at
on public.shared_practice_join_requests;
create trigger trg_touch_shared_practice_join_requests_updated_at
before update on public.shared_practice_join_requests
for each row
execute function public.touch_shared_practice_updated_at();

create table if not exists public.commons_question_answers (
  id uuid primary key default gen_random_uuid(),
  question_id text not null,
  question_text text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body_text text not null,
  visibility text not null default 'public'
    check (visibility in ('public')),
  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden', 'pending_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, user_id),
  constraint commons_question_answers_question_len
    check (char_length(question_id) between 1 and 160),
  constraint commons_question_answers_question_text_len
    check (char_length(question_text) between 1 and 1200),
  constraint commons_question_answers_body_len
    check (char_length(body_text) between 1 and 1200)
);

create index if not exists commons_question_answers_question_created_idx
  on public.commons_question_answers(question_id, created_at desc)
  where moderation_status = 'visible';

create index if not exists commons_question_answers_user_updated_idx
  on public.commons_question_answers(user_id, updated_at desc);

drop trigger if exists trg_touch_commons_question_answers_updated_at
on public.commons_question_answers;
create trigger trg_touch_commons_question_answers_updated_at
before update on public.commons_question_answers
for each row
execute function public.touch_updated_at();

alter table public.shared_practice_join_requests enable row level security;
alter table public.commons_question_answers enable row level security;

create or replace function public.shared_practice_can_read_room(
  p_room_id uuid,
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
    from public.shared_practice_rooms spr
    where spr.id = p_room_id
      and (
        spr.created_by = p_user_id
        or spr.visibility = 'public'
        or public.shared_practice_is_calendar_member(spr.calendar_id, p_user_id)
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
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_practice_rooms spr
    join public.shared_calendars sc
      on sc.id = spr.calendar_id
    where spr.id = p_room_id
      and sc.deleted_at is null
      and (
        spr.created_by = p_user_id
        or sc.owner_id = p_user_id
        or exists (
          select 1
          from public.shared_calendar_members scm
          where scm.calendar_id = spr.calendar_id
            and scm.user_id = p_user_id
            and scm.status = 'accepted'
            and scm.role = 'owner'
        )
      )
  );
$$;

drop policy if exists shared_practice_rooms_select_members
on public.shared_practice_rooms;
drop policy if exists shared_practice_rooms_select_visible
on public.shared_practice_rooms;
create policy shared_practice_rooms_select_visible
on public.shared_practice_rooms
for select
using (
  auth.uid() is not null
  and public.shared_practice_can_read_room(id, auth.uid())
);

drop policy if exists shared_practice_rooms_update_creator_or_owner
on public.shared_practice_rooms;
create policy shared_practice_rooms_update_creator_or_owner
on public.shared_practice_rooms
for update
using (public.shared_practice_can_manage_room(id, auth.uid()))
with check (public.shared_practice_can_manage_room(id, auth.uid()));

drop policy if exists shared_practice_entries_select_visible
on public.shared_practice_entries;
create policy shared_practice_entries_select_visible
on public.shared_practice_entries
for select
using (
  user_id = auth.uid()
  or (
    moderation_status = 'visible'
    and nullif(btrim(coalesce(body_text, '')), '') is not null
    and (
      (
        visibility = 'shared_with_calendar'
        and public.shared_practice_is_calendar_member(
          public.shared_practice_room_calendar_id(room_id)
        )
      )
      or (
        visibility = 'public'
        and public.shared_practice_can_read_room(room_id, auth.uid())
      )
    )
  )
);

drop policy if exists shared_practice_join_requests_select_visible
on public.shared_practice_join_requests;
create policy shared_practice_join_requests_select_visible
on public.shared_practice_join_requests
for select
using (
  requester_id = auth.uid()
  or public.shared_practice_can_manage_room(room_id, auth.uid())
);

drop policy if exists shared_practice_join_requests_insert_own
on public.shared_practice_join_requests;
create policy shared_practice_join_requests_insert_own
on public.shared_practice_join_requests
for insert
with check (requester_id = auth.uid());

drop policy if exists shared_practice_join_requests_update_manage
on public.shared_practice_join_requests;
create policy shared_practice_join_requests_update_manage
on public.shared_practice_join_requests
for update
using (public.shared_practice_can_manage_room(room_id, auth.uid()))
with check (public.shared_practice_can_manage_room(room_id, auth.uid()));

drop policy if exists commons_question_answers_select_visible
on public.commons_question_answers;
create policy commons_question_answers_select_visible
on public.commons_question_answers
for select
to authenticated
using (
  moderation_status = 'visible'
  and not exists (
    select 1
    from public.user_blocks b
    where b.blocker_user_id = auth.uid()
      and b.blocked_user_id = commons_question_answers.user_id
  )
);

drop policy if exists commons_question_answers_insert_own
on public.commons_question_answers;
create policy commons_question_answers_insert_own
on public.commons_question_answers
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists commons_question_answers_update_own
on public.commons_question_answers;
create policy commons_question_answers_update_own
on public.commons_question_answers
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists commons_question_answers_delete_own
on public.commons_question_answers;
create policy commons_question_answers_delete_own
on public.commons_question_answers
for delete
to authenticated
using (user_id = auth.uid());

alter table public.content_reports
  drop constraint if exists content_reports_content_type_check;

alter table public.content_reports
  add constraint content_reports_content_type_check check (
    content_type in (
      'flow_post',
      'flow_post_comment',
      'insight_post',
      'profile',
      'commons_question_answer',
      'shared_practice_room'
    )
  );

create or replace function public.answer_commons_question(
  p_question_id text,
  p_question_text text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_question_id text := nullif(btrim(coalesce(p_question_id, '')), '');
  v_question_text text := nullif(btrim(coalesce(p_question_text, '')), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_answer public.commons_question_answers%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_question_id is null then
    raise exception 'QUESTION_REQUIRED';
  end if;

  if v_question_text is null then
    raise exception 'QUESTION_TEXT_REQUIRED';
  end if;

  if v_body is null then
    raise exception 'ANSWER_REQUIRED';
  end if;

  insert into public.commons_question_answers (
    question_id,
    question_text,
    user_id,
    body_text,
    visibility,
    moderation_status
  )
  values (
    left(v_question_id, 160),
    left(v_question_text, 1200),
    v_uid,
    left(v_body, 1200),
    'public',
    'visible'
  )
  on conflict (question_id, user_id)
  do update
    set question_text = excluded.question_text,
        body_text = excluded.body_text,
        moderation_status = case
          when public.commons_question_answers.moderation_status = 'hidden'
          then public.commons_question_answers.moderation_status
          else 'visible'
        end,
        updated_at = now()
  returning * into v_answer;

  return public.commons_answer_json(v_answer, v_uid);
end;
$$;

create or replace function public.commons_answer_json(
  p_answer public.commons_question_answers,
  p_viewer_id uuid default auth.uid()
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_answer.id,
    'question_id', p_answer.question_id,
    'question_text', p_answer.question_text,
    'user_id', p_answer.user_id,
    'body_text', p_answer.body_text,
    'visibility', p_answer.visibility,
    'moderation_status', p_answer.moderation_status,
    'created_at', p_answer.created_at,
    'updated_at', p_answer.updated_at,
    'author_handle', p.handle,
    'author_display_name', p.display_name,
    'author_avatar_url', p.avatar_url,
    'author_avatar_glyphs', p.avatar_glyphs,
    'is_mine', p_answer.user_id = p_viewer_id
  )
  from public.profiles p
  where p.id = p_answer.user_id;
$$;

create or replace function public.delete_commons_answer(
  p_answer_id uuid
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
    raise exception 'AUTH_REQUIRED';
  end if;

  delete from public.commons_question_answers
  where id = p_answer_id
    and user_id = v_uid;
end;
$$;

create or replace function public.shared_practice_room_card_json(
  p_room public.shared_practice_rooms,
  p_viewer_id uuid default auth.uid()
)
returns jsonb
language sql
stable
security definer
set search_path = public
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
    'created_at', p_room.created_at,
    'updated_at', p_room.updated_at,
    'calendar_name', sc.name,
    'calendar_color', sc.color,
    'owner_handle', owner_profile.handle,
    'owner_display_name', owner_profile.display_name,
    'owner_avatar_url', owner_profile.avatar_url,
    'member_count', coalesce(member_counts.member_count, 0),
    'pending_request_count', case
      when public.shared_practice_can_manage_room(p_room.id, p_viewer_id)
      then coalesce(request_counts.pending_request_count, 0)
      else 0
    end,
    'viewer_is_member', public.shared_practice_is_calendar_member(
      p_room.calendar_id,
      p_viewer_id
    ),
    'viewer_can_manage', public.shared_practice_can_manage_room(
      p_room.id,
      p_viewer_id
    ),
    'viewer_request_status', (
      select sprj.status
      from public.shared_practice_join_requests sprj
      where sprj.room_id = p_room.id
        and sprj.requester_id = p_viewer_id
      order by sprj.created_at desc
      limit 1
    )
  )
  from public.shared_calendars sc
  left join public.profiles owner_profile
    on owner_profile.id = p_room.created_by
  left join lateral (
    select count(*)::integer as member_count
    from public.shared_calendar_members scm
    where scm.calendar_id = p_room.calendar_id
      and scm.status = 'accepted'
  ) member_counts on true
  left join lateral (
    select count(*)::integer as pending_request_count
    from public.shared_practice_join_requests sprj
    where sprj.room_id = p_room.id
      and sprj.status = 'pending'
  ) request_counts on true
  where sc.id = p_room.calendar_id
    and sc.deleted_at is null;
$$;

create or replace function public.set_shared_practice_visibility(
  p_room_id uuid,
  p_visibility text,
  p_join_policy text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_visibility text := lower(nullif(btrim(coalesce(p_visibility, '')), ''));
  v_join_policy text := lower(nullif(btrim(coalesce(p_join_policy, '')), ''));
  v_room public.shared_practice_rooms%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.shared_practice_can_manage_room(p_room_id, v_uid) then
    raise exception 'ROOM_NOT_MANAGEABLE';
  end if;

  if v_visibility not in ('private', 'unlisted', 'public') then
    raise exception 'INVALID_VISIBILITY';
  end if;

  if v_join_policy is null then
    v_join_policy := case
      when v_visibility = 'public' then 'owner_approval'
      else 'closed'
    end;
  end if;

  if v_join_policy not in ('owner_approval', 'open', 'closed') then
    raise exception 'INVALID_JOIN_POLICY';
  end if;

  update public.shared_practice_rooms
     set visibility = v_visibility,
         join_policy = v_join_policy,
         updated_at = now()
   where id = p_room_id
  returning * into v_room;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  return public.shared_practice_room_card_json(v_room, v_uid);
end;
$$;

create or replace function public.request_join_shared_practice(
  p_room_id uuid,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.shared_practice_rooms%rowtype;
  v_request public.shared_practice_join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_room
  from public.shared_practice_rooms
  where id = p_room_id
    and status = 'active';

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_room.visibility <> 'public' then
    raise exception 'ROOM_NOT_PUBLIC';
  end if;

  if v_room.join_policy = 'closed' then
    raise exception 'ROOM_CLOSED';
  end if;

  if public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid) then
    return jsonb_build_object('status', 'approved', 'already_member', true);
  end if;

  if public.shared_practice_can_manage_room(v_room.id, v_uid) then
    raise exception 'CANNOT_REQUEST_OWN_ROOM';
  end if;

  if v_room.join_policy = 'open' then
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
      v_uid,
      'viewer',
      'accepted',
      v_room.created_by,
      now()
    )
    on conflict (calendar_id, user_id)
    do update
      set role = case
            when public.shared_calendar_members.role = 'owner'
            then public.shared_calendar_members.role
            else 'viewer'
          end,
          status = 'accepted',
          invited_by = coalesce(public.shared_calendar_members.invited_by, v_room.created_by),
          responded_at = now(),
          updated_at = now();

    insert into public.shared_practice_join_requests (
      room_id,
      requester_id,
      message,
      status,
      responded_by,
      responded_at
    )
    values (
      v_room.id,
      v_uid,
      nullif(btrim(coalesce(p_message, '')), ''),
      'approved',
      v_room.created_by,
      now()
    )
    returning * into v_request;

    return jsonb_build_object(
      'id', v_request.id,
      'room_id', v_request.room_id,
      'requester_id', v_request.requester_id,
      'status', v_request.status,
      'created_at', v_request.created_at,
      'responded_at', v_request.responded_at
    );
  end if;

  insert into public.shared_practice_join_requests (
    room_id,
    requester_id,
    message,
    status
  )
  values (
    v_room.id,
    v_uid,
    nullif(btrim(coalesce(p_message, '')), ''),
    'pending'
  )
  on conflict (room_id, requester_id) where status = 'pending'
  do update
    set message = excluded.message,
        updated_at = now()
  returning * into v_request;

  return jsonb_build_object(
    'id', v_request.id,
    'room_id', v_request.room_id,
    'requester_id', v_request.requester_id,
    'status', v_request.status,
    'created_at', v_request.created_at,
    'responded_at', v_request.responded_at
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
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_decision text := lower(nullif(btrim(coalesce(p_decision, '')), ''));
  v_request public.shared_practice_join_requests%rowtype;
  v_room public.shared_practice_rooms%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_decision not in ('approved', 'denied') then
    raise exception 'INVALID_DECISION';
  end if;

  select *
    into v_request
  from public.shared_practice_join_requests
  where id = p_request_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  select *
    into v_room
  from public.shared_practice_rooms
  where id = v_request.room_id;

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
    do update
      set role = case
            when public.shared_calendar_members.role = 'owner'
            then public.shared_calendar_members.role
            else 'viewer'
          end,
          status = 'accepted',
          invited_by = coalesce(public.shared_calendar_members.invited_by, v_uid),
          responded_at = now(),
          updated_at = now();
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'room_id', v_request.room_id,
    'requester_id', v_request.requester_id,
    'status', v_request.status,
    'responded_by', v_request.responded_by,
    'responded_at', v_request.responded_at,
    'created_at', v_request.created_at,
    'updated_at', v_request.updated_at
  );
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
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.shared_practice_rooms%rowtype;
  v_status text := lower(coalesce(nullif(btrim(p_completion_status), ''), ''));
  v_visibility text := lower(coalesce(nullif(btrim(p_visibility), ''), 'private'));
  v_body text := nullif(btrim(p_body_text), '');
  v_entry public.shared_practice_entries%rowtype;
  v_metadata jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_room
  from public.shared_practice_rooms spr
  where spr.id = p_room_id
    and spr.status = 'active';

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if not public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;

  if v_status not in ('observed', 'partial', 'skipped') then
    raise exception 'INVALID_COMPLETION_STATUS';
  end if;

  if v_visibility not in ('private', 'shared_with_calendar', 'public') then
    raise exception 'INVALID_VISIBILITY';
  end if;

  if v_visibility = 'public' and v_room.visibility <> 'public' then
    raise exception 'PUBLIC_ENTRY_REQUIRES_PUBLIC_ROOM';
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

create or replace function public.get_commons_home(
  p_local_date date default current_date,
  p_question_id text default null,
  p_question_text text default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_local_date date := coalesce(p_local_date, current_date);
  v_question_id text := coalesce(
    nullif(btrim(coalesce(p_question_id, '')), ''),
    'daily-reflection:' || coalesce(p_local_date, current_date)::text
  );
  v_question_text text := nullif(btrim(coalesce(p_question_text, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 24);
  v_active_users bigint := 0;
  v_flows_kept bigint := 0;
  v_public_fragments bigint := 0;
  v_public_rooms bigint := 0;
  v_top_flow_title text;
  v_top_flow_count bigint := 0;
  v_answers jsonb := '[]'::jsonb;
  v_my_answer jsonb := null;
  v_my_practices jsonb := '[]'::jsonb;
  v_public_practices jsonb := '[]'::jsonb;
  v_fragments jsonb := '[]'::jsonb;
  v_discover jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select count(distinct spe.user_id), count(*)::bigint
    into v_active_users, v_flows_kept
  from public.shared_practice_entries spe
  join public.shared_practice_rooms spr
    on spr.id = spe.room_id
  join public.profiles p
    on p.id = spe.user_id
  where spe.completed_on = v_local_date
    and spe.visibility = 'public'
    and spe.moderation_status = 'visible'
    and spr.status = 'active'
    and spr.visibility = 'public'
    and coalesce(p.is_discoverable, true) = true
    and not exists (
      select 1
      from public.user_blocks b
      where b.blocker_user_id = v_uid
        and b.blocked_user_id = spe.user_id
    );

  select count(*)::bigint
    into v_public_fragments
  from public.insight_posts ip
  join public.profiles p on p.id = ip.user_id
  where coalesce(ip.is_hidden, false) = false
    and coalesce(p.is_discoverable, true) = true
    and (ip.created_at at time zone 'UTC')::date = v_local_date
    and not exists (
      select 1
      from public.user_blocks b
      where b.blocker_user_id = v_uid
        and b.blocked_user_id = ip.user_id
    );

  select count(*)::bigint
    into v_public_rooms
  from public.shared_practice_rooms spr
  where spr.status = 'active'
    and spr.visibility = 'public'
    and spr.join_policy <> 'closed'
    and not exists (
      select 1
      from public.user_blocks b
      where b.blocker_user_id = v_uid
        and b.blocked_user_id = spr.created_by
    );

  select f.name, count(*)::bigint
    into v_top_flow_title, v_top_flow_count
  from public.shared_practice_entries spe
  join public.shared_practice_rooms spr
    on spr.id = spe.room_id
  join public.profiles p
    on p.id = spe.user_id
  join public.flows f
    on f.id = spe.flow_id
  where spe.completed_on = v_local_date
    and spe.visibility = 'public'
    and spe.moderation_status = 'visible'
    and spr.status = 'active'
    and spr.visibility = 'public'
    and coalesce(p.is_discoverable, true) = true
    and not exists (
      select 1
      from public.user_blocks b
      where b.blocker_user_id = v_uid
        and b.blocked_user_id = spe.user_id
    )
  group by f.name
  order by count(*) desc, f.name asc
  limit 1;

  with answer_ids as (
    select cqa.id
    from public.commons_question_answers cqa
    where cqa.question_id = v_question_id
      and cqa.moderation_status = 'visible'
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = v_uid
          and b.blocked_user_id = cqa.user_id
      )
    order by
      case when cqa.user_id = v_uid then 0 else 1 end,
      cqa.updated_at desc
    limit v_limit
  )
  select coalesce(
      jsonb_agg(
        public.commons_answer_json(cqa, v_uid)
        order by
          case when cqa.user_id = v_uid then 0 else 1 end,
          cqa.updated_at desc
      ),
      '[]'::jsonb
    )
    into v_answers
  from answer_ids ai
  join public.commons_question_answers cqa
    on cqa.id = ai.id;

  select public.commons_answer_json(cqa, v_uid)
    into v_my_answer
  from public.commons_question_answers cqa
  where cqa.question_id = v_question_id
    and cqa.user_id = v_uid
  limit 1;

  with room_ids as (
    select spr.id
    from public.shared_practice_rooms spr
    where spr.status = 'active'
      and (
        spr.created_by = v_uid
        or public.shared_practice_is_calendar_member(spr.calendar_id, v_uid)
      )
    order by
      case when spr.created_by = v_uid then 0 else 1 end,
      spr.updated_at desc
    limit v_limit
  )
  select coalesce(
      jsonb_agg(
        public.shared_practice_room_card_json(spr, v_uid)
        order by
          case when spr.created_by = v_uid then 0 else 1 end,
          spr.updated_at desc
      ),
      '[]'::jsonb
    )
    into v_my_practices
  from room_ids ri
  join public.shared_practice_rooms spr
    on spr.id = ri.id;

  with room_ids as (
    select spr.id
    from public.shared_practice_rooms spr
    where spr.status = 'active'
      and spr.visibility = 'public'
      and (
        spr.created_by <> v_uid
        and not public.shared_practice_is_calendar_member(spr.calendar_id, v_uid)
      )
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = v_uid
          and b.blocked_user_id = spr.created_by
      )
    order by spr.updated_at desc
    limit v_limit
  )
  select coalesce(
      jsonb_agg(
        public.shared_practice_room_card_json(spr, v_uid)
        order by spr.updated_at desc
      ),
      '[]'::jsonb
    )
    into v_public_practices
  from room_ids ri
  join public.shared_practice_rooms spr
    on spr.id = ri.id;

  with fragment_rows as (
    select
      ip.id,
      ip.user_id,
      ip.insight_entry_id,
      n.slug as node_slug,
      n.title as node_title,
      n.glyph as node_glyph,
      ip.body_text,
      ip.entry_date,
      ip.is_hidden,
      ip.created_at,
      ip.updated_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      p.avatar_glyphs as author_avatar_glyphs
    from public.insight_posts ip
    join public.profiles p on p.id = ip.user_id
    left join public.nodes n on n.id = ip.node_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = v_uid
          and b.blocked_user_id = ip.user_id
      )
    order by ip.created_at desc
    limit 3
  )
  select coalesce(jsonb_agg(to_jsonb(fragment_rows)), '[]'::jsonb)
    into v_fragments
  from fragment_rows;

  with flow_rows as (
    select
      'flow'::text as post_type,
      fp.id,
      fp.user_id,
      fp.flow_id,
      fp.name,
      fp.color,
      fp.notes,
      fp.rules,
      fp.start_date,
      fp.end_date,
      fp.ai_metadata,
      null::uuid as insight_entry_id,
      null::text as node_slug,
      null::text as node_title,
      null::text as node_glyph,
      null::text as body_text,
      null::date as entry_date,
      fp.is_hidden,
      fp.created_at,
      fp.updated_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      p.avatar_glyphs as author_avatar_glyphs
    from public.flow_posts fp
    join public.profiles p on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = v_uid
          and b.blocked_user_id = fp.user_id
      )
    order by fp.created_at desc
    limit 4
  ),
  insight_rows as (
    select
      'insight'::text as post_type,
      ip.id,
      ip.user_id,
      null::bigint as flow_id,
      null::text as name,
      null::bigint as color,
      null::text as notes,
      null::jsonb as rules,
      null::date as start_date,
      null::date as end_date,
      null::jsonb as ai_metadata,
      ip.insight_entry_id,
      n.slug as node_slug,
      n.title as node_title,
      n.glyph as node_glyph,
      ip.body_text,
      ip.entry_date,
      ip.is_hidden,
      ip.created_at,
      ip.updated_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      p.avatar_glyphs as author_avatar_glyphs
    from public.insight_posts ip
    join public.profiles p on p.id = ip.user_id
    left join public.nodes n on n.id = ip.node_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = v_uid
          and b.blocked_user_id = ip.user_id
      )
    order by ip.created_at desc
    limit 4
  ),
  combined as (
    select * from flow_rows
    union all
    select * from insight_rows
  )
  select coalesce(jsonb_agg(to_jsonb(combined) order by created_at desc), '[]'::jsonb)
    into v_discover
  from combined;

  return jsonb_build_object(
    'rhythm', jsonb_build_object(
      'active_users_today', v_active_users,
      'active_users_today_label', case
        when v_active_users >= 3 then v_active_users::text
        when v_active_users > 0 then 'a few'
        else '0'
      end,
      'flows_kept_today', v_flows_kept,
      'flows_kept_today_label', case
        when v_flows_kept >= 3 then v_flows_kept::text
        when v_flows_kept > 0 then 'a few'
        else '0'
      end,
      'public_fragments_today', v_public_fragments,
      'public_fragments_today_label', case
        when v_public_fragments >= 3 then v_public_fragments::text
        when v_public_fragments > 0 then 'a few'
        else '0'
      end,
      'public_rooms_open', v_public_rooms,
      'public_rooms_open_label', case
        when v_public_rooms >= 3 then v_public_rooms::text
        when v_public_rooms > 0 then 'a few'
        else '0'
      end,
      'top_flow', case
        when v_top_flow_title is null then null
        else jsonb_build_object(
          'title', v_top_flow_title,
          'count_label', case
            when v_top_flow_count >= 3 then v_top_flow_count::text
            when v_top_flow_count > 0 then 'a few'
            else '0'
          end
        )
      end
    ),
    'questions', jsonb_build_array(
      jsonb_build_object(
        'id', v_question_id,
        'question', v_question_text,
        'answers', v_answers,
        'my_answer', v_my_answer
      )
    ),
    'my_shared_practices', v_my_practices,
    'public_shared_practices', v_public_practices,
    'fragments', v_fragments,
    'discover', v_discover
  );
end;
$$;

create or replace function public.get_community_rhythm_rollups(
  p_local_date date default current_date,
  p_privacy_threshold integer default 3
)
returns table (
  metric text,
  count_label text,
  is_thresholded boolean,
  sort_order integer
)
language sql
security definer
stable
set search_path = public
as $$
  with args as (
    select
      coalesce(p_local_date, current_date) as local_date,
      greatest(coalesce(p_privacy_threshold, 3), 3) as privacy_threshold,
      auth.uid() as viewer_id
  ),
  raw_counts as (
    select
      'flow_steps_completed'::text as metric,
      count(distinct spe.user_id)::bigint as raw_count,
      1 as sort_order
    from public.shared_practice_entries spe
    join public.shared_practice_rooms spr
      on spr.id = spe.room_id
    join public.profiles p
      on p.id = spe.user_id
    join args on true
    where spe.completed_on = args.local_date
      and spe.visibility = 'public'
      and spe.moderation_status = 'visible'
      and spr.status = 'active'
      and spr.visibility = 'public'
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = spe.user_id
      )

    union all

    select
      'flows_began'::text as metric,
      count(distinct spr.created_by)::bigint as raw_count,
      2 as sort_order
    from public.shared_practice_rooms spr
    join public.profiles p
      on p.id = spr.created_by
    join args on true
    where spr.status = 'active'
      and spr.visibility = 'public'
      and coalesce(spr.start_date, (spr.created_at at time zone 'UTC')::date)
        = args.local_date
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = spr.created_by
      )

    union all

    select
      'reflections_recorded'::text as metric,
      count(distinct cqa.user_id)::bigint as raw_count,
      3 as sort_order
    from public.commons_question_answers cqa
    join args on true
    where cqa.moderation_status = 'visible'
      and (cqa.created_at at time zone 'UTC')::date = args.local_date
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = cqa.user_id
      )

    union all

    select
      'insight_fragments_shared'::text as metric,
      count(distinct ip.user_id)::bigint as raw_count,
      4 as sort_order
    from public.insight_posts ip
    join public.profiles p on p.id = ip.user_id
    join args on true
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and (ip.created_at at time zone 'UTC')::date = args.local_date
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = ip.user_id
      )
  )
  select
    raw_counts.metric,
    case
      when raw_counts.raw_count >= args.privacy_threshold
        then raw_counts.raw_count::text
      when raw_counts.raw_count > 0
        then 'a few'
      else null
    end as count_label,
    raw_counts.raw_count > 0
      and raw_counts.raw_count < args.privacy_threshold as is_thresholded,
    raw_counts.sort_order
  from raw_counts
  cross join args
  order by raw_counts.sort_order;
$$;

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
  v_join_requests jsonb := '[]'::jsonb;
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

  if not public.shared_practice_can_read_room(v_room.id, v_uid) then
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

  if public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid) then
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
  end if;

  if public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid) then
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
          when spe.moderation_status = 'visible'
            and nullif(btrim(coalesce(spe.body_text, '')), '') is not null
            and (
              spe.visibility = 'shared_with_calendar'
              or (
                spe.visibility = 'public'
                and v_room.visibility = 'public'
              )
            )
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
  end if;

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
      or (
        public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid)
        and spe.visibility in ('shared_with_calendar', 'public')
      )
      or (
        v_room.visibility = 'public'
        and spe.visibility = 'public'
      )
    );

  if public.shared_practice_can_manage_room(v_room.id, v_uid) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', sprj.id,
          'room_id', sprj.room_id,
          'requester_id', sprj.requester_id,
          'message', sprj.message,
          'status', sprj.status,
          'created_at', sprj.created_at,
          'updated_at', sprj.updated_at,
          'responded_at', sprj.responded_at,
          'requester_handle', p.handle,
          'requester_display_name', p.display_name,
          'requester_avatar_url', p.avatar_url
        )
        order by sprj.created_at asc
      ),
      '[]'::jsonb
    )
      into v_join_requests
    from public.shared_practice_join_requests sprj
    left join public.profiles p
      on p.id = sprj.requester_id
    where sprj.room_id = v_room.id
      and sprj.status = 'pending';
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
    'entries', v_entries,
    'join_requests', v_join_requests,
    'viewer_can_manage', public.shared_practice_can_manage_room(v_room.id, v_uid),
    'viewer_is_member', public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid)
  );
end;
$$;

revoke all on function public.shared_practice_can_read_room(uuid, uuid) from public;
revoke all on function public.shared_practice_can_manage_room(uuid, uuid) from public;
revoke all on function public.commons_answer_json(public.commons_question_answers, uuid) from public;
revoke all on function public.shared_practice_room_card_json(public.shared_practice_rooms, uuid) from public;
revoke all on function public.answer_commons_question(text, text, text) from public;
revoke all on function public.delete_commons_answer(uuid) from public;
revoke all on function public.set_shared_practice_visibility(uuid, text, text) from public;
revoke all on function public.request_join_shared_practice(uuid, text) from public;
revoke all on function public.respond_to_join_request(uuid, text) from public;
revoke all on function public.get_commons_home(date, text, text, integer) from public;

grant execute on function public.shared_practice_can_read_room(uuid, uuid) to authenticated;
grant execute on function public.shared_practice_can_manage_room(uuid, uuid) to authenticated;
grant execute on function public.answer_commons_question(text, text, text) to authenticated;
grant execute on function public.delete_commons_answer(uuid) to authenticated;
grant execute on function public.set_shared_practice_visibility(uuid, text, text) to authenticated;
grant execute on function public.request_join_shared_practice(uuid, text) to authenticated;
grant execute on function public.respond_to_join_request(uuid, text) to authenticated;
grant execute on function public.get_commons_home(date, text, text, integer) to authenticated;

grant select, insert, update on public.shared_practice_join_requests to authenticated;
grant select, insert, update, delete on public.commons_question_answers to authenticated;

notify pgrst, 'reload schema';
