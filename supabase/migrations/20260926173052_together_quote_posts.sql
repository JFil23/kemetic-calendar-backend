-- Selected group-chat messages may become public social posts. A member may
-- publish their own words immediately; quoting another member requires that
-- author's explicit Inbox approval. Public quote posts support likes and
-- comments, while the parent group-flow card remains like-only.

create table if not exists public.shared_practice_quote_posts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.shared_practice_rooms(id) on delete cascade,
  source_message_id uuid not null unique
    references public.shared_practice_messages(id) on delete cascade,
  quoted_user_id uuid not null references auth.users(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  body_text text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  responded_by uuid references auth.users(id) on delete set null,
  responded_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_practice_quote_posts_body_check
    check (char_length(btrim(body_text)) between 1 and 2000)
);

create index if not exists shared_practice_quote_posts_public_idx
  on public.shared_practice_quote_posts(published_at desc, id desc)
  where status = 'approved';

create index if not exists shared_practice_quote_posts_inbox_idx
  on public.shared_practice_quote_posts(quoted_user_id, created_at)
  where status = 'pending';

create table if not exists public.shared_practice_quote_likes (
  quote_post_id uuid not null
    references public.shared_practice_quote_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (quote_post_id, user_id)
);

create table if not exists public.shared_practice_quote_comments (
  id uuid primary key default gen_random_uuid(),
  quote_post_id uuid not null
    references public.shared_practice_quote_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body_text text not null,
  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shared_practice_quote_comments_body_check
    check (char_length(btrim(body_text)) between 1 and 1000)
);

create index if not exists shared_practice_quote_comments_post_idx
  on public.shared_practice_quote_comments(
    quote_post_id,
    created_at,
    id
  )
  where deleted_at is null and moderation_status = 'visible';

drop trigger if exists trg_touch_shared_practice_quote_posts_updated_at
on public.shared_practice_quote_posts;
create trigger trg_touch_shared_practice_quote_posts_updated_at
before update on public.shared_practice_quote_posts
for each row execute function public.touch_shared_practice_updated_at();

drop trigger if exists trg_touch_shared_practice_quote_comments_updated_at
on public.shared_practice_quote_comments;
create trigger trg_touch_shared_practice_quote_comments_updated_at
before update on public.shared_practice_quote_comments
for each row execute function public.touch_shared_practice_updated_at();

alter table public.shared_practice_quote_posts enable row level security;
alter table public.shared_practice_quote_likes enable row level security;
alter table public.shared_practice_quote_comments enable row level security;

drop policy if exists shared_practice_quote_posts_select_visible
on public.shared_practice_quote_posts;
create policy shared_practice_quote_posts_select_visible
on public.shared_practice_quote_posts
for select to authenticated
using (
  (
    status = 'approved'
    and exists (
      select 1
      from public.shared_practice_rooms room
      where room.id = shared_practice_quote_posts.room_id
        and room.visibility = 'public'
        and room.status = 'active'
        and public.shared_practice_accepted_member_count(room.id) >= 2
    )
  )
  or public.shared_practice_is_room_member(
    room_id,
    (select auth.uid())
  )
);

drop policy if exists shared_practice_quote_likes_select_visible
on public.shared_practice_quote_likes;
create policy shared_practice_quote_likes_select_visible
on public.shared_practice_quote_likes
for select to authenticated
using (
  exists (
    select 1
    from public.shared_practice_quote_posts post
    join public.shared_practice_rooms room on room.id = post.room_id
    where post.id = shared_practice_quote_likes.quote_post_id
      and post.status = 'approved'
      and room.visibility = 'public'
      and room.status = 'active'
      and public.shared_practice_accepted_member_count(room.id) >= 2
  )
);

drop policy if exists shared_practice_quote_comments_select_visible
on public.shared_practice_quote_comments;
create policy shared_practice_quote_comments_select_visible
on public.shared_practice_quote_comments
for select to authenticated
using (
  deleted_at is null
  and moderation_status = 'visible'
  and exists (
    select 1
    from public.shared_practice_quote_posts post
    join public.shared_practice_rooms room on room.id = post.room_id
    where post.id = shared_practice_quote_comments.quote_post_id
      and post.status = 'approved'
      and room.visibility = 'public'
      and room.status = 'active'
      and public.shared_practice_accepted_member_count(room.id) >= 2
  )
);

revoke all on table public.shared_practice_quote_posts
from anon, authenticated;
revoke all on table public.shared_practice_quote_likes
from anon, authenticated;
revoke all on table public.shared_practice_quote_comments
from anon, authenticated;
grant select on table public.shared_practice_quote_posts to authenticated;
grant select on table public.shared_practice_quote_likes to authenticated;
grant select on table public.shared_practice_quote_comments to authenticated;

create or replace function private.shared_practice_quote_is_public(
  p_quote_post_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.shared_practice_quote_posts post
    join public.shared_practice_rooms room on room.id = post.room_id
    where post.id = p_quote_post_id
      and post.status = 'approved'
      and room.visibility = 'public'
      and room.status = 'active'
      and public.shared_practice_accepted_member_count(room.id) >= 2
  )
$$;

create or replace function public.request_shared_practice_quote_post(
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.shared_practice_messages%rowtype;
  v_post public.shared_practice_quote_posts%rowtype;
  v_approved boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_message
  from public.shared_practice_messages message
  where message.id = p_message_id
    and message.deleted_at is null
    and message.moderation_status = 'visible';

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;
  if not public.shared_practice_is_room_member(v_message.room_id, v_uid) then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;

  v_approved := v_message.user_id = v_uid;

  insert into public.shared_practice_quote_posts (
    room_id,
    source_message_id,
    quoted_user_id,
    submitted_by,
    body_text,
    status,
    responded_by,
    responded_at,
    published_at
  ) values (
    v_message.room_id,
    v_message.id,
    v_message.user_id,
    v_uid,
    v_message.body_text,
    case when v_approved then 'approved' else 'pending' end,
    case when v_approved then v_uid else null end,
    case when v_approved then now() else null end,
    case when v_approved then now() else null end
  )
  on conflict (source_message_id)
  do update set
    submitted_by = excluded.submitted_by,
    body_text = excluded.body_text,
    status = case
      when public.shared_practice_quote_posts.status = 'approved'
        then 'approved'
      else excluded.status
    end,
    responded_by = case
      when public.shared_practice_quote_posts.status = 'approved'
        then public.shared_practice_quote_posts.responded_by
      else excluded.responded_by
    end,
    responded_at = case
      when public.shared_practice_quote_posts.status = 'approved'
        then public.shared_practice_quote_posts.responded_at
      else excluded.responded_at
    end,
    published_at = case
      when public.shared_practice_quote_posts.status = 'approved'
        then public.shared_practice_quote_posts.published_at
      else excluded.published_at
    end,
    updated_at = now()
  returning * into v_post;

  return jsonb_build_object(
    'id', v_post.id,
    'room_id', v_post.room_id,
    'source_message_id', v_post.source_message_id,
    'quoted_user_id', v_post.quoted_user_id,
    'submitted_by', v_post.submitted_by,
    'body_text', v_post.body_text,
    'status', v_post.status,
    'approval_required', v_post.status = 'pending',
    'published_at', v_post.published_at,
    'created_at', v_post.created_at,
    'updated_at', v_post.updated_at
  );
end;
$$;

create or replace function public.respond_to_shared_practice_quote_post(
  p_quote_post_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.shared_practice_quote_posts%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_practice_quote_posts post
     set status = case when p_approve then 'approved' else 'denied' end,
         responded_by = v_uid,
         responded_at = now(),
         published_at = case when p_approve then now() else null end,
         updated_at = now()
   where post.id = p_quote_post_id
     and post.quoted_user_id = v_uid
     and post.status = 'pending'
  returning * into v_post;

  if not found then
    raise exception 'QUOTE_APPROVAL_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_post.id,
    'room_id', v_post.room_id,
    'status', v_post.status,
    'published_at', v_post.published_at,
    'updated_at', v_post.updated_at
  );
end;
$$;

create or replace function public.toggle_shared_practice_quote_like(
  p_quote_post_id uuid
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
  if not private.shared_practice_quote_is_public(p_quote_post_id) then
    raise exception 'PUBLIC_QUOTE_NOT_FOUND';
  end if;

  delete from public.shared_practice_quote_likes quote_like
  where quote_like.quote_post_id = p_quote_post_id
    and quote_like.user_id = v_uid;

  if found then
    v_liked := false;
  else
    insert into public.shared_practice_quote_likes(quote_post_id, user_id)
    values (p_quote_post_id, v_uid);
    v_liked := true;
  end if;

  select count(*)::integer into v_count
  from public.shared_practice_quote_likes quote_like
  where quote_like.quote_post_id = p_quote_post_id;

  return jsonb_build_object(
    'quote_post_id', p_quote_post_id,
    'liked_by_me', v_liked,
    'likes_count', v_count
  );
end;
$$;

create or replace function public.add_shared_practice_quote_comment(
  p_quote_post_id uuid,
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
  v_comment public.shared_practice_quote_comments%rowtype;
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_body is null or char_length(v_body) > 1000 then
    raise exception 'INVALID_COMMENT';
  end if;
  if not private.shared_practice_quote_is_public(p_quote_post_id) then
    raise exception 'PUBLIC_QUOTE_NOT_FOUND';
  end if;

  insert into public.shared_practice_quote_comments(
    quote_post_id,
    user_id,
    body_text
  ) values (p_quote_post_id, v_uid, v_body)
  returning * into v_comment;

  select * into v_profile
  from public.profiles profile
  where profile.id = v_uid;

  return jsonb_build_object(
    'id', v_comment.id,
    'quote_post_id', v_comment.quote_post_id,
    'user_id', v_comment.user_id,
    'body_text', v_comment.body_text,
    'created_at', v_comment.created_at,
    'updated_at', v_comment.updated_at,
    'author_handle', v_profile.handle,
    'author_display_name', v_profile.display_name,
    'author_avatar_url', v_profile.avatar_url
  );
end;
$$;

create or replace function public.delete_shared_practice_quote_comment(
  p_comment_id uuid
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

  update public.shared_practice_quote_comments comment
     set deleted_at = now(),
         updated_at = now()
   where comment.id = p_comment_id
     and comment.deleted_at is null
     and (
       comment.user_id = v_uid
       or exists (
         select 1
         from public.shared_practice_quote_posts post
         where post.id = comment.quote_post_id
           and public.shared_practice_can_manage_room(post.room_id, v_uid)
       )
     );

  if not found then
    raise exception 'COMMENT_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.get_shared_practice_quote_posts(
  p_room_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_posts jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_room_id is not null
     and not public.shared_practice_is_room_member(p_room_id, v_uid) then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(post_row) order by post_row.sort_at desc),
    '[]'::jsonb
  ) into v_posts
  from (
    select
      post.id,
      post.room_id,
      post.source_message_id,
      post.quoted_user_id,
      post.submitted_by,
      post.body_text,
      post.status,
      post.published_at,
      post.created_at,
      post.updated_at,
      coalesce(post.published_at, post.created_at) as sort_at,
      room.title as flow_title,
      room.source_flow_id,
      case when coalesce(member.public_identity, false)
        then profile.handle else null end as author_handle,
      case when coalesce(member.public_identity, false)
        then profile.display_name else null end as author_display_name,
      case when coalesce(member.public_identity, false)
        then profile.avatar_url else null end as author_avatar_url,
      coalesce(member.public_identity, false) as author_is_public,
      (
        select count(*)::integer
        from public.shared_practice_quote_likes quote_like
        where quote_like.quote_post_id = post.id
      ) as likes_count,
      exists (
        select 1
        from public.shared_practice_quote_likes quote_like
        where quote_like.quote_post_id = post.id
          and quote_like.user_id = v_uid
      ) as liked_by_me,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', comment.id,
              'quote_post_id', comment.quote_post_id,
              'user_id', comment.user_id,
              'body_text', comment.body_text,
              'created_at', comment.created_at,
              'updated_at', comment.updated_at,
              'author_handle', commenter.handle,
              'author_display_name', commenter.display_name,
              'author_avatar_url', commenter.avatar_url
            ) order by comment.created_at, comment.id
          )
          from (
            select comment.*
            from public.shared_practice_quote_comments comment
            where comment.quote_post_id = post.id
              and comment.deleted_at is null
              and comment.moderation_status = 'visible'
            order by comment.created_at desc, comment.id desc
            limit 30
          ) comment
          left join public.profiles commenter on commenter.id = comment.user_id
        ),
        '[]'::jsonb
      ) as comments
    from public.shared_practice_quote_posts post
    join public.shared_practice_rooms room on room.id = post.room_id
    left join public.shared_practice_room_members member
      on member.room_id = post.room_id
     and member.user_id = post.quoted_user_id
     and member.status = 'accepted'
    left join public.profiles profile on profile.id = post.quoted_user_id
    where (
      p_room_id is not null
      and post.room_id = p_room_id
      and (
        post.status = 'approved'
        or post.quoted_user_id = v_uid
        or post.submitted_by = v_uid
        or public.shared_practice_can_manage_room(post.room_id, v_uid)
      )
    ) or (
      p_room_id is null
      and post.status = 'approved'
      and room.status = 'active'
      and room.visibility = 'public'
      and public.shared_practice_accepted_member_count(room.id) >= 2
      and not exists (
        select 1
        from public.user_blocks block
        where (
          block.blocker_user_id = v_uid
          and block.blocked_user_id = post.quoted_user_id
        ) or (
          block.blocker_user_id = post.quoted_user_id
          and block.blocked_user_id = v_uid
        )
      )
    )
    order by coalesce(post.published_at, post.created_at) desc
    limit v_limit
  ) post_row;

  return v_posts;
end;
$$;

create or replace function public.get_together_quote_approvals(
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
      select jsonb_agg(to_jsonb(approval_row) order by created_at)
      from (
        select
          post.id,
          post.room_id,
          post.source_message_id,
          post.submitted_by,
          post.body_text,
          post.status,
          post.created_at,
          room.title as flow_title,
          submitter.handle as submitter_handle,
          submitter.display_name as submitter_display_name,
          submitter.avatar_url as submitter_avatar_url
        from public.shared_practice_quote_posts post
        join public.shared_practice_rooms room on room.id = post.room_id
        left join public.profiles submitter on submitter.id = post.submitted_by
        where post.quoted_user_id = v_uid
          and post.status = 'pending'
        order by post.created_at
        limit v_limit
      ) approval_row
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function private.shared_practice_quote_is_public(uuid)
from public;
revoke all on function public.request_shared_practice_quote_post(uuid)
from public;
revoke all on function public.respond_to_shared_practice_quote_post(uuid, boolean)
from public;
revoke all on function public.toggle_shared_practice_quote_like(uuid)
from public;
revoke all on function public.add_shared_practice_quote_comment(uuid, text)
from public;
revoke all on function public.delete_shared_practice_quote_comment(uuid)
from public;
revoke all on function public.get_shared_practice_quote_posts(uuid, integer)
from public;
revoke all on function public.get_together_quote_approvals(integer)
from public;

grant execute on function public.request_shared_practice_quote_post(uuid)
to authenticated;
grant execute on function public.respond_to_shared_practice_quote_post(uuid, boolean)
to authenticated;
grant execute on function public.toggle_shared_practice_quote_like(uuid)
to authenticated;
grant execute on function public.add_shared_practice_quote_comment(uuid, text)
to authenticated;
grant execute on function public.delete_shared_practice_quote_comment(uuid)
to authenticated;
grant execute on function public.get_shared_practice_quote_posts(uuid, integer)
to authenticated;
grant execute on function public.get_together_quote_approvals(integer)
to authenticated;

notify pgrst, 'reload schema';
