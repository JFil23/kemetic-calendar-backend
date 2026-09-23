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
  page as (
    select item, score, created_at, id
    from ranked
    order by score desc, created_at desc, id desc
    limit (select limit_rows from args)
    offset (select offset_rows from args)
  )
  select coalesce(
    jsonb_agg(item order by score desc, created_at desc, id desc),
    '[]'::jsonb
  )
  from page;
$$;

comment on function public.get_profile_feed_cards(integer, integer) is
  'Fast ranked mixed social feed. It returns only card-sized flow metadata; detail and save hydrate the full immutable post snapshot by id.';

notify pgrst, 'reload schema';
