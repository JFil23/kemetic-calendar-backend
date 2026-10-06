begin;

-- Private aggregation authority: only explicitly public activity belonging to
-- accounts followed by auth.uid(). Never read personal journal/checklist data.
create or replace function private.commons_following_rhythm(p_local_date date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with followed as materialized (
    select f.followee_id as id
    from public.follows f
    join public.profiles p on p.id = f.followee_id
    where f.follower_id = (select auth.uid())
      and coalesce(p.is_discoverable, true)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = auth.uid() and b.blocked_user_id = f.followee_id)
           or (b.blocker_user_id = f.followee_id and b.blocked_user_id = auth.uid())
      )
  ), public_steps as (
    select e.id, e.user_id
    from followed f
    join public.shared_practice_entries e on e.user_id = f.id
    join public.shared_practice_rooms r on r.id = e.room_id
    where e.completed_on = coalesce(p_local_date, current_date)
      and e.visibility = 'public' and e.moderation_status = 'visible'
      and e.completion_status in ('observed', 'partial')
      and r.visibility = 'public' and r.status = 'active'
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = auth.uid() and b.blocked_user_id = r.created_by)
           or (b.blocker_user_id = r.created_by and b.blocked_user_id = auth.uid())
      )
  )
  select jsonb_build_object(
    'scope', 'following',
    'active_users_today', (select count(distinct user_id) from public_steps),
    'flows_kept_today', (select count(*) from public_steps),
    'public_fragments_today', (
      select count(*) from followed f
      join public.insight_posts ip on ip.user_id = f.id
      where not coalesce(ip.is_hidden, false)
        and ip.created_at >= coalesce(p_local_date, current_date)::timestamp at time zone 'UTC'
        and ip.created_at < (coalesce(p_local_date, current_date) + 1)::timestamp at time zone 'UTC'
    ),
    'public_rooms_open', (
      select count(*) from followed f
      join public.shared_practice_rooms r on r.created_by = f.id
      where r.visibility = 'public' and r.status = 'active'
        and public.shared_practice_accepted_member_count(r.id) >= 2
        and public.shared_practice_can_request_room(r.id, auth.uid())
    )
  );
$$;
revoke all on function private.commons_following_rhythm(date) from public, anon, authenticated;

-- Created-at plus ID is immutable across edits and deterministic for ties.
-- Fetch one extra ID for has_more; serialize only the bounded requested page.
create index if not exists commons_answers_public_page_idx
  on public.commons_question_answers(question_id, created_at desc, id desc)
  where visibility = 'public' and moderation_status = 'visible';

create or replace function public.get_commons_question_answers(
  p_question_id text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 24);
  v_result jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'CURSOR_REQUIRED';
  end if;
  with candidates as materialized (
    select a.* from public.commons_question_answers a
    where a.question_id = btrim(p_question_id)
      and a.visibility = 'public' and a.moderation_status = 'visible'
      and (p_before_created_at is null or
        (a.created_at, a.id) < (p_before_created_at, p_before_id))
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = v_uid and b.blocked_user_id = a.user_id)
           or (b.blocker_user_id = a.user_id and b.blocked_user_id = v_uid)
      )
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ), page as (
    select * from candidates order by created_at desc, id desc limit v_limit
  )
  select jsonb_build_object(
    'answers', coalesce((select jsonb_agg(public.commons_answer_json(a, v_uid)
      order by a.created_at desc, a.id desc)
      from public.commons_question_answers a join page p on p.id = a.id), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from candidates)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_commons_question_answers(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_commons_question_answers(text, timestamptz, uuid, integer) to authenticated;

create or replace function public.get_commons_home_cards(
  p_local_date date default current_date,
  p_question_id text default '',
  p_question_text text default '',
  p_limit integer default 12
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, private, pg_temp
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
  v_answer_page jsonb;
  v_my_answer jsonb := null;
  v_my_practices jsonb := '[]'::jsonb;
  v_public_practices jsonb := '[]'::jsonb;
  v_fragments jsonb := '[]'::jsonb;
  v_discover jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_answer_page := public.get_commons_question_answers(v_question_id, null, null, v_limit);

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
  join public.shared_practice_rooms spr on spr.id = ri.id;

  with room_ids as (
    select spr.id
    from public.shared_practice_rooms spr
    where spr.status = 'active'
      and spr.visibility = 'public'
      and spr.created_by <> v_uid
      and not public.shared_practice_is_calendar_member(spr.calendar_id, v_uid)
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
  join public.shared_practice_rooms spr on spr.id = ri.id;

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

  v_discover := public.get_profile_feed_cards(8, 0);

  return jsonb_build_object(
    'rhythm', private.commons_following_rhythm(v_local_date),
    'questions', jsonb_build_array(
      jsonb_build_object(
        'id', v_question_id,
        'question', v_question_text,
        'answers', v_answer_page -> 'answers',
        'answers_has_more', v_answer_page -> 'has_more',
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

comment on function public.get_commons_home_cards(date, text, text, integer) is
  'Bounded Commons home for the app: followed public rhythm, paginated public answers, owned/member Reading Houses, public rooms, fragments, and the card-sized social feed.';

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

  v_home := jsonb_set(v_home, '{my_shared_practices}', v_my_groups, true);
  v_home := jsonb_set(
    v_home,
    '{public_shared_practices}',
    v_public_groups,
    true
  );
  return v_home;
end;
$$;

notify pgrst, 'reload schema';
commit;
