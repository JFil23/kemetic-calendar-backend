begin;

-- Feed surfaces consume one bounded card payload. Complete immutable flow
-- snapshots remain a detail concern and are loaded by post id.
create or replace function public.get_profile_feed_cards(
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language sql
security definer
stable
set search_path = public, private
as $$
  with
  args as (
    select
      greatest(1, least(coalesce(p_limit, 24), 48)) as limit_rows,
      greatest(0, coalesce(p_offset, 0)) as offset_rows,
      auth.uid() as viewer_id
  ),
  recent_flows as (
    select
      jsonb_build_object(
        'post_type', 'flow',
        'id', fp.id,
        'user_id', fp.user_id,
        'flow_id', fp.flow_id,
        'name', fp.name,
        'color', fp.color,
        'notes', fp.notes,
        'rules', fp.rules,
        'start_date', fp.start_date,
        'end_date', fp.end_date,
        'ai_metadata', private.social_flow_post_card_metadata(fp.ai_metadata),
        'insight_entry_id', null,
        'node_slug', null,
        'node_title', null,
        'node_glyph', null,
        'body_text', null,
        'entry_date', null,
        'is_hidden', fp.is_hidden,
        'created_at', fp.created_at,
        'updated_at', fp.updated_at,
        'author_handle', p.handle,
        'author_display_name', p.display_name,
        'author_avatar_url', p.avatar_url,
        'author_avatar_glyphs', p.avatar_glyphs,
        'likes_count', coalesce(likes.likes_count, 0),
        'comments_count', coalesce(comments.comments_count, 0),
        'liked_by_me', coalesce(viewer_like.liked_by_me, false),
        'score', (
          case
            when fp.user_id = args.viewer_id then 6.5
            when following.is_following then 4.0
            else 0.0
          end
          + least(
              coalesce(likes.likes_count, 0) * 0.18
                + coalesce(comments.comments_count, 0) * 0.42,
              4.5
            )
          + exp(
              - greatest(
                  extract(epoch from (timezone('utc', now()) - fp.created_at))
                    / 3600.0,
                  0.0
                ) / 72.0
            ) * 5.5
        ),
        'is_following_author', following.is_following
      ) as item,
      (
        case
          when fp.user_id = args.viewer_id then 6.5
          when following.is_following then 4.0
          else 0.0
        end
        + least(
            coalesce(likes.likes_count, 0) * 0.18
              + coalesce(comments.comments_count, 0) * 0.42,
            4.5
          )
        + exp(
            - greatest(
                extract(epoch from (timezone('utc', now()) - fp.created_at))
                  / 3600.0,
                0.0
              ) / 72.0
          ) * 5.5
      )::numeric as score,
      fp.created_at,
      fp.id
    from public.flow_posts fp
    join public.profiles p on p.id = fp.user_id
    join args on true
    left join lateral (
      select count(*)::integer as likes_count
      from public.flow_post_likes l
      where l.flow_post_id = fp.id
    ) likes on true
    left join lateral (
      select count(*)::integer as comments_count
      from public.flow_post_comments c
      where c.flow_post_id = fp.id
    ) comments on true
    left join lateral (
      select true as liked_by_me
      from public.flow_post_likes l
      where l.flow_post_id = fp.id
        and l.user_id = args.viewer_id
      limit 1
    ) viewer_like on true
    left join lateral (
      select exists(
        select 1
        from public.follows f
        where f.follower_id = args.viewer_id
          and f.followee_id = fp.user_id
      ) as is_following
    ) following on true
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = fp.user_id
      )
    order by fp.created_at desc
    limit (select (limit_rows + offset_rows) * 3 from args)
  ),
  recent_insights as (
    select
      jsonb_build_object(
        'post_type', 'insight',
        'id', ip.id,
        'user_id', ip.user_id,
        'flow_id', null,
        'name', null,
        'color', null,
        'notes', null,
        'rules', null,
        'start_date', null,
        'end_date', null,
        'ai_metadata', null,
        'insight_entry_id', ip.insight_entry_id,
        'node_slug', n.slug,
        'node_title', n.title,
        'node_glyph', n.glyph,
        'body_text', ip.body_text,
        'entry_date', ip.entry_date,
        'is_hidden', ip.is_hidden,
        'created_at', ip.created_at,
        'updated_at', ip.updated_at,
        'author_handle', p.handle,
        'author_display_name', p.display_name,
        'author_avatar_url', p.avatar_url,
        'author_avatar_glyphs', p.avatar_glyphs,
        'likes_count', 0,
        'comments_count', 0,
        'liked_by_me', null,
        'score', (
          case
            when ip.user_id = args.viewer_id then 6.5
            when following.is_following then 4.0
            else 0.0
          end
          + exp(
              - greatest(
                  extract(epoch from (timezone('utc', now()) - ip.created_at))
                    / 3600.0,
                  0.0
                ) / 72.0
            ) * 5.1
        ),
        'is_following_author', following.is_following
      ) as item,
      (
        case
          when ip.user_id = args.viewer_id then 6.5
          when following.is_following then 4.0
          else 0.0
        end
        + exp(
            - greatest(
                extract(epoch from (timezone('utc', now()) - ip.created_at))
                  / 3600.0,
                0.0
              ) / 72.0
          ) * 5.1
      )::numeric as score,
      ip.created_at,
      ip.id
    from public.insight_posts ip
    join public.profiles p on p.id = ip.user_id
    left join public.nodes n on n.id = ip.node_id
    join args on true
    left join lateral (
      select exists(
        select 1
        from public.follows f
        where f.follower_id = args.viewer_id
          and f.followee_id = ip.user_id
      ) as is_following
    ) following on true
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = args.viewer_id
          and b.blocked_user_id = ip.user_id
      )
    order by ip.created_at desc
    limit (select (limit_rows + offset_rows) * 3 from args)
  ),
  ranked as (
    select item, score, created_at, id from recent_flows
    union all
    select item, score, created_at, id from recent_insights
  ),
  author_ranked as (
    select
      item,
      score,
      created_at,
      id,
      row_number() over (
        partition by item ->> 'user_id'
        order by score desc, created_at desc, id desc
      ) as author_sequence
    from ranked
  ),
  page as (
    select item, score, created_at, id, author_sequence
    from author_ranked
    order by author_sequence asc, score desc, created_at desc, id desc
    limit (select limit_rows from args)
    offset (select offset_rows from args)
  )
  select coalesce(
    jsonb_agg(
      item
      order by author_sequence asc, score desc, created_at desc, id desc
    ),
    '[]'::jsonb
  )
  from page;
$$;

comment on function public.get_profile_feed_cards(integer, integer) is
  'Fast ranked mixed social feed. Each author receives one placement before repeat posts from the same author, so a prolific account cannot monopolize the first page. It returns only card-sized flow metadata; detail and save hydrate the full immutable post snapshot by id.';

create or replace function public.get_profile_feed(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  post_type text,
  id uuid,
  user_id uuid,
  flow_id bigint,
  name text,
  color bigint,
  notes text,
  rules jsonb,
  start_date date,
  end_date date,
  ai_metadata jsonb,
  insight_entry_id uuid,
  node_slug text,
  node_title text,
  node_glyph text,
  body_text text,
  entry_date date,
  is_hidden boolean,
  created_at timestamptz,
  updated_at timestamptz,
  author_handle text,
  author_display_name text,
  author_avatar_url text,
  author_avatar_glyphs jsonb,
  likes_count integer,
  comments_count integer,
  liked_by_me boolean,
  score numeric,
  is_following_author boolean
)
language sql
security definer
stable
set search_path = public, private, pg_temp
as $$
  select card.*
  from jsonb_to_recordset(
    public.get_profile_feed_cards(p_limit, p_offset)
  ) as card(
    post_type text,
    id uuid,
    user_id uuid,
    flow_id bigint,
    name text,
    color bigint,
    notes text,
    rules jsonb,
    start_date date,
    end_date date,
    ai_metadata jsonb,
    insight_entry_id uuid,
    node_slug text,
    node_title text,
    node_glyph text,
    body_text text,
    entry_date date,
    is_hidden boolean,
    created_at timestamptz,
    updated_at timestamptz,
    author_handle text,
    author_display_name text,
    author_avatar_url text,
    author_avatar_glyphs jsonb,
    likes_count integer,
    comments_count integer,
    liked_by_me boolean,
    score numeric,
    is_following_author boolean
  );
$$;

comment on function public.get_profile_feed(integer, integer) is
  'Compatibility projection of the single bounded get_profile_feed_cards list authority. Full snapshots are loaded by post id.';

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

create or replace function public.get_commons_home(
  p_local_date date default current_date,
  p_question_id text default '',
  p_question_text text default '',
  p_limit integer default 12
)
returns jsonb
language sql
security definer
stable
set search_path = public, private, pg_temp
as $$
  select public.get_commons_home_cards(
    p_local_date,
    p_question_id,
    p_question_text,
    p_limit
  );
$$;

comment on function public.get_commons_home(date, text, text, integer) is
  'Compatibility delegate to the single bounded get_commons_home_cards authority.';

-- My Flows is a catalog screen, not a full-account history report. Restrict
-- accounting to flows that can actually appear in Active or Saved before
-- reading event history. This preserves the existing row contract and detail
-- hydration while removing hidden, reminder, deleted, and closed history from
-- the list request.
create or replace function public.get_my_filed_flows_v1(
  p_limit integer default null
)
returns table (
  id bigint,
  user_id uuid,
  calendar_id uuid,
  name text,
  color bigint,
  active boolean,
  is_saved boolean,
  start_date date,
  end_date date,
  notes text,
  rules jsonb,
  ai_metadata jsonb,
  appearance jsonb,
  is_hidden boolean,
  is_reminder boolean,
  reminder_uuid uuid,
  share_id uuid,
  origin_share_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  saved_at timestamptz,
  lifecycle text,
  visible_in_active_list boolean,
  visible_in_saved_list boolean,
  total_event_count bigint,
  remaining_event_count bigint,
  remaining_live_event_count bigint,
  is_shared boolean,
  is_posted boolean,
  is_shared_calendar_source boolean,
  is_flow_share_source boolean
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_timezone text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_timezone := coalesce(
    nullif(btrim(public._get_user_timezone(v_uid)), ''),
    'UTC'
  );

  return query
  with flow_rows as materialized (
    select
      f.*,
      sc.is_personal as calendar_is_personal,
      fsaves.saved_at as flow_saved_at,
      (coalesce(f.is_saved, false) or fsaves.flow_id is not null)
        as filed_is_saved,
      public.flow_record_kind(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      ) as record_kind,
      exists (
        select 1
        from public.flow_shares fshare
        where fshare.flow_id = f.id
          and fshare.deleted_at is null
          and coalesce(fshare.status, 'pending')
            in ('sent', 'viewed', 'imported', 'public')
      ) as has_flow_share,
      exists (
        select 1
        from public.flow_posts fp
        where fp.flow_id = f.id
          and coalesce(fp.is_hidden, false) = false
      ) as has_flow_post
    from public.flows f
    join public.shared_calendars sc
      on sc.id = f.calendar_id
     and sc.deleted_at is null
    join public.shared_calendar_members scm
      on scm.calendar_id = f.calendar_id
     and scm.user_id = v_uid
     and scm.status = 'accepted'
    left join public.flow_saves fsaves
      on fsaves.flow_id = f.id
     and fsaves.user_id = v_uid
    where f.user_id = v_uid
      and public.flow_is_deleted_state(
        f.active,
        f.is_hidden,
        f.notes
      ) = false
      and coalesce(f.is_reminder, false) = false
      and public.flow_record_kind(
        f.active,
        f.is_hidden,
        f.is_reminder,
        f.notes
      ) in ('active', 'inactive')
      and (
        coalesce(f.is_saved, false)
        or fsaves.flow_id is not null
        or (
          coalesce(f.active, false) = true
          and public.flow_is_schedule_open(
            f.end_date,
            v_timezone,
            v_now
          )
        )
      )
  ),
  flow_ids as materialized (
    select coalesce(
      array_agg(f.id order by f.id),
      array[]::bigint[]
    )::bigint[] as ids
    from flow_rows f
  ),
  activity as materialized (
    select summary.*
    from flow_ids
    cross join lateral private.flow_activity_summary_v1(
      v_uid,
      flow_ids.ids
    ) summary
    where cardinality(flow_ids.ids) > 0
  )
  select
    f.id,
    f.user_id,
    f.calendar_id,
    f.name,
    f.color,
    f.active,
    f.filed_is_saved as is_saved,
    f.start_date,
    f.end_date,
    f.notes,
    f.rules,
    f.ai_metadata,
    f.appearance,
    coalesce(f.is_hidden, false) as is_hidden,
    coalesce(f.is_reminder, false) as is_reminder,
    f.reminder_uuid,
    f.share_id,
    f.origin_share_id,
    f.created_at,
    f.updated_at,
    f.flow_saved_at as saved_at,
    case when activity.is_counted_active then 'active' else 'inactive' end,
    activity.is_counted_active as visible_in_active_list,
    f.filed_is_saved as visible_in_saved_list,
    activity.total_event_count,
    activity.remaining_event_count,
    activity.remaining_live_event_count,
    (
      coalesce(f.calendar_is_personal, true) = false
      or f.has_flow_share
    ) as is_shared,
    f.has_flow_post as is_posted,
    (coalesce(f.calendar_is_personal, true) = false)
      as is_shared_calendar_source,
    f.has_flow_share as is_flow_share_source
  from flow_rows f
  join activity on activity.flow_id = f.id
  where activity.is_counted_active or f.filed_is_saved
  order by f.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.get_my_filed_flows_v1(integer) from public;
revoke all on function public.get_my_filed_flows_v1(integer) from anon;
grant execute on function public.get_my_filed_flows_v1(integer)
  to authenticated;

comment on function public.get_my_filed_flows_v1(integer) is
  'Single bounded My Flows list authority. Candidate filtering precedes event accounting; detail history remains loaded by flow id.';

notify pgrst, 'reload schema';

commit;
