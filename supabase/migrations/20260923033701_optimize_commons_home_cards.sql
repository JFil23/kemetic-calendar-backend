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
set search_path = public, private
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
  v_rhythm_labels jsonb := '{}'::jsonb;
  v_public_rooms bigint := 0;
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

  select coalesce(jsonb_object_agg(metric, count_label), '{}'::jsonb)
    into v_rhythm_labels
  from public.get_community_rhythm_rollups(v_local_date, 3);

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
  join public.commons_question_answers cqa on cqa.id = ai.id;

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
    'rhythm', jsonb_build_object(
      'active_users_today_label', coalesce(
        v_rhythm_labels ->> 'flow_steps_completed',
        '0'
      ),
      'flows_kept_today_label', coalesce(
        v_rhythm_labels ->> 'flow_steps_completed',
        '0'
      ),
      'public_fragments_today_label', coalesce(
        v_rhythm_labels ->> 'insight_fragments_shared',
        '0'
      ),
      'public_rooms_open_label', case
        when v_public_rooms >= 3 then v_public_rooms::text
        when v_public_rooms > 0 then 'a few'
        else '0'
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

comment on function public.get_commons_home_cards(date, text, text, integer) is
  'Bounded Commons home for the app: privacy-safe rhythm labels, answers, owned/member Reading Houses, public rooms, fragments, and the card-sized social feed.';

notify pgrst, 'reload schema';
