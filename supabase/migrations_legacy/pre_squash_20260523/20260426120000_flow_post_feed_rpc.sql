create index if not exists flow_posts_visible_created_at_idx
  on public.flow_posts (created_at desc)
  where coalesce(is_hidden, false) = false;

create or replace function public.get_flow_post_feed(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  id uuid,
  user_id uuid,
  flow_id bigint,
  name text,
  color bigint,
  notes text,
  rules jsonb,
  start_date date,
  end_date date,
  is_hidden boolean,
  ai_metadata jsonb,
  created_at timestamptz,
  author_handle text,
  author_display_name text,
  author_avatar_url text,
  likes_count integer,
  comments_count integer,
  score numeric,
  is_following_author boolean
)
language sql
security definer
set search_path = public
as $$
  with
  args as (
    select
      greatest(1, least(coalesce(p_limit, 24), 48)) as limit_rows,
      greatest(0, coalesce(p_offset, 0)) as offset_rows
  ),
  viewer as (
    select auth.uid() as user_id
  ),
  viewer_profile as (
    select
      coalesce(
        (
          select array(
            select distinct slug
            from (
              select elem ->> 'slug' as slug
              from jsonb_array_elements(coalesce(rp.top_nodes, '[]'::jsonb)) elem
              union all
              select dominant_slug.slug
              from jsonb_array_elements_text(
                coalesce(rp.dominant_patterns, '[]'::jsonb)
              ) as dominant_slug(slug)
            ) viewer_slugs
            where coalesce(slug, '') <> ''
          )
          from public.reflection_profiles rp
          where rp.user_id = (select user_id from viewer)
        ),
        '{}'::text[]
      ) as nodes,
      coalesce(
        (
          select case
            when rp.isfet_risk_score is not null
              and rp.maat_score is not null
              and rp.isfet_risk_score > rp.maat_score
              then 'reduce_scatter'
            when rp.maat_score is not null
              and rp.maat_score > 0
              then 'reinforce_structure'
            else 'neutral'
          end
          from public.reflection_profiles rp
          where rp.user_id = (select user_id from viewer)
        ),
        'neutral'
      ) as balance_mode
  ),
  followed_authors as (
    select f.followee_id
    from public.follows f
    where f.follower_id = (select user_id from viewer)
    union
    select v.user_id
    from viewer v
    where v.user_id is not null
  ),
  followed_recent as (
    select fp.id
    from public.flow_posts fp
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and fp.user_id in (select followee_id from followed_authors)
    order by fp.created_at desc
    limit (select limit_rows from args) * 8
  ),
  community_recent as (
    select fp.id
    from public.flow_posts fp
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from followed_authors fa
        where fa.followee_id = fp.user_id
      )
    order by fp.created_at desc
    limit (select limit_rows from args) * 12
  ),
  candidate_posts as (
    select id from followed_recent
    union
    select id from community_recent
  ),
  posts as (
    select
      fp.id,
      fp.user_id,
      fp.flow_id,
      fp.name,
      fp.color,
      fp.notes,
      fp.rules,
      fp.start_date,
      fp.end_date,
      fp.is_hidden,
      fp.ai_metadata,
      fp.created_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      exists(
        select 1
        from public.follows f
        where f.follower_id = (select user_id from viewer)
          and f.followee_id = fp.user_id
      ) as is_following_author
    from public.flow_posts fp
    join candidate_posts cp
      on cp.id = fp.id
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
  ),
  post_likes as (
    select
      l.flow_post_id,
      count(*)::integer as likes_count
    from public.flow_post_likes l
    where l.flow_post_id in (select id from posts)
    group by l.flow_post_id
  ),
  post_comments as (
    select
      c.flow_post_id,
      count(*)::integer as comments_count
    from public.flow_post_comments c
    where c.flow_post_id in (select id from posts)
    group by c.flow_post_id
  ),
  author_profiles as (
    select
      rp.user_id,
      array(
        select distinct slug
        from (
          select elem ->> 'slug' as slug
          from jsonb_array_elements(coalesce(rp.top_nodes, '[]'::jsonb)) elem
          union all
          select dominant_slug.slug
          from jsonb_array_elements_text(
            coalesce(rp.dominant_patterns, '[]'::jsonb)
          ) as dominant_slug(slug)
        ) author_slugs
        where coalesce(slug, '') <> ''
      ) as nodes,
      case
        when rp.isfet_risk_score is not null
          and rp.maat_score is not null
          and rp.isfet_risk_score > rp.maat_score
          then 'reduce_scatter'
        when rp.maat_score is not null
          and rp.maat_score > 0
          then 'reinforce_structure'
        else 'neutral'
      end as balance_mode
    from public.reflection_profiles rp
    where rp.user_id in (select distinct user_id from posts)
  ),
  scored_posts as (
    select
      p.id,
      p.user_id,
      p.flow_id,
      p.name,
      p.color,
      p.notes,
      p.rules,
      p.start_date,
      p.end_date,
      p.is_hidden,
      p.ai_metadata,
      p.created_at,
      p.author_handle,
      p.author_display_name,
      p.author_avatar_url,
      coalesce(pl.likes_count, 0) as likes_count,
      coalesce(pc.comments_count, 0) as comments_count,
      p.is_following_author,
      (
        case
          when p.user_id = (select user_id from viewer) then 6.5
          when p.is_following_author then 4.0
          else 0.0
        end
        + least(
          coalesce(pl.likes_count, 0) * 0.18
            + coalesce(pc.comments_count, 0) * 0.42,
          4.5
        )
        + exp(
          - greatest(
              extract(epoch from (timezone('utc', now()) - p.created_at))
                / 3600.0,
              0.0
            ) / 72.0
        ) * 5.5
        + coalesce(
            (
              select count(*)::numeric
              from unnest((select vp.nodes from viewer_profile vp)) viewer_node(slug)
              where viewer_node.slug = any(coalesce(ap.nodes, '{}'::text[]))
            ),
            0
          ) * 0.9
        + case
          when ap.balance_mode = (select vp.balance_mode from viewer_profile vp)
            and ap.balance_mode <> 'neutral'
            then 0.45
          else 0.0
        end
      )::numeric as score
    from posts p
    left join post_likes pl
      on pl.flow_post_id = p.id
    left join post_comments pc
      on pc.flow_post_id = p.id
    left join author_profiles ap
      on ap.user_id = p.user_id
  )
  select
    sp.id,
    sp.user_id,
    sp.flow_id,
    sp.name,
    sp.color,
    sp.notes,
    sp.rules,
    sp.start_date,
    sp.end_date,
    sp.is_hidden,
    sp.ai_metadata,
    sp.created_at,
    sp.author_handle,
    sp.author_display_name,
    sp.author_avatar_url,
    sp.likes_count,
    sp.comments_count,
    sp.score,
    sp.is_following_author
  from scored_posts sp
  order by sp.score desc, sp.created_at desc, sp.id desc
  limit (select limit_rows from args)
  offset (select offset_rows from args);
$$;

comment on function public.get_flow_post_feed(integer, integer) is
  'Returns a ranked page of public flow posts using follows, recency, engagement, and cached knowledge-graph overlap.';

revoke all on function public.get_flow_post_feed(integer, integer) from public;
grant execute on function public.get_flow_post_feed(integer, integer) to authenticated;
