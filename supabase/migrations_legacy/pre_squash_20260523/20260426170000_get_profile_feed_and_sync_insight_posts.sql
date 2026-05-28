create or replace function public.sync_insight_post_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.insight_posts
  set
    node_id = new.node_id,
    body_text = new.body_text,
    entry_date = new.entry_date,
    updated_at = timezone('utc', now())
  where insight_entry_id = new.id
    and user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_sync_insight_post_snapshot on public.node_insight_entries;
create trigger trg_sync_insight_post_snapshot
after insert or update of node_id, body_text, entry_date
on public.node_insight_entries
for each row execute procedure public.sync_insight_post_snapshot();

drop function if exists public.get_profile_feed(integer, integer);

create function public.get_profile_feed(
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
  followed_flow_recent as (
    select
      'flow'::text as post_type,
      fp.id
    from public.flow_posts fp
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and fp.user_id in (select followee_id from followed_authors)
    order by fp.created_at desc
    limit (select limit_rows from args) * 8
  ),
  community_flow_recent as (
    select
      'flow'::text as post_type,
      fp.id
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
  followed_insight_recent as (
    select
      'insight'::text as post_type,
      ip.id
    from public.insight_posts ip
    join public.profiles p
      on p.id = ip.user_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and ip.user_id in (select followee_id from followed_authors)
    order by ip.created_at desc
    limit (select limit_rows from args) * 8
  ),
  community_insight_recent as (
    select
      'insight'::text as post_type,
      ip.id
    from public.insight_posts ip
    join public.profiles p
      on p.id = ip.user_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
      and not exists (
        select 1
        from followed_authors fa
        where fa.followee_id = ip.user_id
      )
    order by ip.created_at desc
    limit (select limit_rows from args) * 12
  ),
  candidate_posts as (
    select post_type, id from followed_flow_recent
    union
    select post_type, id from community_flow_recent
    union
    select post_type, id from followed_insight_recent
    union
    select post_type, id from community_insight_recent
  ),
  flow_posts as (
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
      fp.created_at as updated_at,
      p.handle as author_handle,
      p.display_name as author_display_name,
      p.avatar_url as author_avatar_url,
      p.avatar_glyphs as author_avatar_glyphs,
      exists(
        select 1
        from public.follows f
        where f.follower_id = (select user_id from viewer)
          and f.followee_id = fp.user_id
      ) as is_following_author
    from public.flow_posts fp
    join candidate_posts cp
      on cp.post_type = 'flow'
     and cp.id = fp.id
    join public.profiles p
      on p.id = fp.user_id
    where coalesce(fp.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
  ),
  insight_posts as (
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
      p.avatar_glyphs as author_avatar_glyphs,
      exists(
        select 1
        from public.follows f
        where f.follower_id = (select user_id from viewer)
          and f.followee_id = ip.user_id
      ) as is_following_author
    from public.insight_posts ip
    join candidate_posts cp
      on cp.post_type = 'insight'
     and cp.id = ip.id
    join public.nodes n
      on n.id = ip.node_id
    join public.profiles p
      on p.id = ip.user_id
    where coalesce(ip.is_hidden, false) = false
      and coalesce(p.is_discoverable, true) = true
  ),
  posts as (
    select * from flow_posts
    union all
    select * from insight_posts
  ),
  flow_likes as (
    select
      l.flow_post_id,
      count(*)::integer as likes_count
    from public.flow_post_likes l
    where l.flow_post_id in (
      select p.id
      from posts p
      where p.post_type = 'flow'
    )
    group by l.flow_post_id
  ),
  flow_viewer_likes as (
    select
      l.flow_post_id,
      true as liked_by_me
    from public.flow_post_likes l
    where l.user_id = (select user_id from viewer)
      and l.flow_post_id in (
        select p.id
        from posts p
        where p.post_type = 'flow'
      )
  ),
  flow_comments as (
    select
      c.flow_post_id,
      count(*)::integer as comments_count
    from public.flow_post_comments c
    where c.flow_post_id in (
      select p.id
      from posts p
      where p.post_type = 'flow'
    )
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
      p.post_type,
      p.id,
      p.user_id,
      p.flow_id,
      p.name,
      p.color,
      p.notes,
      p.rules,
      p.start_date,
      p.end_date,
      p.ai_metadata,
      p.insight_entry_id,
      p.node_slug,
      p.node_title,
      p.node_glyph,
      p.body_text,
      p.entry_date,
      p.is_hidden,
      p.created_at,
      p.updated_at,
      p.author_handle,
      p.author_display_name,
      p.author_avatar_url,
      p.author_avatar_glyphs,
      case
        when p.post_type = 'flow' then coalesce(fl.likes_count, 0)
        else 0
      end as likes_count,
      case
        when p.post_type = 'flow' then coalesce(fc.comments_count, 0)
        else 0
      end as comments_count,
      case
        when p.post_type = 'flow' then coalesce(fvl.liked_by_me, false)
        else null
      end as liked_by_me,
      p.is_following_author,
      (
        case
          when p.user_id = (select user_id from viewer) then 6.5
          when p.is_following_author then 4.0
          else 0.0
        end
        + case
          when p.post_type = 'flow'
            then least(
              coalesce(fl.likes_count, 0) * 0.18
                + coalesce(fc.comments_count, 0) * 0.42,
              4.5
            )
          else 0.0
        end
        + exp(
          - greatest(
              extract(epoch from (timezone('utc', now()) - p.created_at))
                / 3600.0,
              0.0
            ) / 72.0
        ) * case
          when p.post_type = 'flow' then 5.5
          else 5.1
        end
        + coalesce(
            (
              select count(*)::numeric
              from unnest((select vp.nodes from viewer_profile vp)) viewer_node(slug)
              where viewer_node.slug = any(coalesce(ap.nodes, '{}'::text[]))
            ),
            0
          ) * 0.9
        + case
          when p.post_type = 'insight'
            and coalesce(p.node_slug, '') <> ''
            and p.node_slug = any(
              coalesce((select vp.nodes from viewer_profile vp), '{}'::text[])
            )
            then 1.25
          else 0.0
        end
        + case
          when ap.balance_mode = (select vp.balance_mode from viewer_profile vp)
            and ap.balance_mode <> 'neutral'
            then 0.45
          else 0.0
        end
      )::numeric as score
    from posts p
    left join flow_likes fl
      on fl.flow_post_id = p.id
    left join flow_comments fc
      on fc.flow_post_id = p.id
    left join flow_viewer_likes fvl
      on fvl.flow_post_id = p.id
    left join author_profiles ap
      on ap.user_id = p.user_id
  )
  select
    sp.post_type,
    sp.id,
    sp.user_id,
    sp.flow_id,
    sp.name,
    sp.color,
    sp.notes,
    sp.rules,
    sp.start_date,
    sp.end_date,
    sp.ai_metadata,
    sp.insight_entry_id,
    sp.node_slug,
    sp.node_title,
    sp.node_glyph,
    sp.body_text,
    sp.entry_date,
    sp.is_hidden,
    sp.created_at,
    sp.updated_at,
    sp.author_handle,
    sp.author_display_name,
    sp.author_avatar_url,
    sp.author_avatar_glyphs,
    sp.likes_count,
    sp.comments_count,
    sp.liked_by_me,
    sp.score,
    sp.is_following_author
  from scored_posts sp
  order by
    sp.score desc,
    sp.created_at desc,
    sp.id desc
  limit (select limit_rows from args)
  offset (select offset_rows from args);
$$;

comment on function public.get_profile_feed(integer, integer) is
  'Returns a ranked mixed feed of posted flows and posted insights using follows, recency, engagement, and reflection-profile overlap.';
