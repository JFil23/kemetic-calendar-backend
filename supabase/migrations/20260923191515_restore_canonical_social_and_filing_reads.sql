begin;

-- Filing reads touch only a small projection of user_events. The existing
-- index still forces heap reads through large detail/behavior payload pages,
-- which becomes the dominant cost when the project is under I/O pressure.
create index if not exists user_events_flow_filing_cover_idx
  on public.user_events (user_id, flow_local_id, starts_at)
  include (id, client_event_id, category, all_day, ends_at)
  where flow_local_id is not null;

create index if not exists flow_posts_flow_id_visible_idx
  on public.flow_posts (flow_id)
  where coalesce(is_hidden, false) = false;

-- Restore the original full-snapshot contract under the original RPC name.
-- The social UI has one data owner again: this function returns complete post
-- snapshots, author identity, engagement, and ranking in one bounded result.
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
set search_path = public, pg_temp
as $$
  with
  args as (
    select
      greatest(1, least(coalesce(p_limit, 24), 48)) as limit_rows,
      greatest(0, coalesce(p_offset, 0)) as offset_rows,
      auth.uid() as viewer_id
  ),
  followed as materialized (
    select f.followee_id
    from public.follows f, args
    where f.follower_id = args.viewer_id
  ),
  recent_flows as materialized (
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
      p.avatar_glyphs as author_avatar_glyphs,
      coalesce(likes.likes_count, 0)::integer as likes_count,
      coalesce(comments.comments_count, 0)::integer as comments_count,
      coalesce(viewer_like.liked_by_me, false) as liked_by_me,
      (
        case
          when fp.user_id = args.viewer_id then 6.5
          when followed.followee_id is not null then 4.0
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
      (followed.followee_id is not null) as is_following_author
    from public.flow_posts fp
    join public.profiles p on p.id = fp.user_id
    join args on true
    left join followed on followed.followee_id = fp.user_id
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
  recent_insights as materialized (
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
      0::integer as likes_count,
      0::integer as comments_count,
      null::boolean as liked_by_me,
      (
        case
          when ip.user_id = args.viewer_id then 6.5
          when followed.followee_id is not null then 4.0
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
      (followed.followee_id is not null) as is_following_author
    from public.insight_posts ip
    join public.profiles p on p.id = ip.user_id
    left join public.nodes n on n.id = ip.node_id
    join args on true
    left join followed on followed.followee_id = ip.user_id
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
    select * from recent_flows
    union all
    select * from recent_insights
  ),
  author_ranked as (
    select
      ranked.*,
      row_number() over (
        partition by ranked.user_id
        order by ranked.score desc, ranked.created_at desc, ranked.id desc
      ) as author_sequence
    from ranked
  )
  select
    ar.post_type,
    ar.id,
    ar.user_id,
    ar.flow_id,
    ar.name,
    ar.color,
    ar.notes,
    ar.rules,
    ar.start_date,
    ar.end_date,
    ar.ai_metadata,
    ar.insight_entry_id,
    ar.node_slug,
    ar.node_title,
    ar.node_glyph,
    ar.body_text,
    ar.entry_date,
    ar.is_hidden,
    ar.created_at,
    ar.updated_at,
    ar.author_handle,
    ar.author_display_name,
    ar.author_avatar_url,
    ar.author_avatar_glyphs,
    ar.likes_count,
    ar.comments_count,
    ar.liked_by_me,
    ar.score,
    ar.is_following_author
  from author_ranked ar
  order by
    ar.author_sequence asc,
    ar.score desc,
    ar.created_at desc,
    ar.id desc
  limit (select limit_rows from args)
  offset (select offset_rows from args)
$$;

comment on function public.get_profile_feed(integer, integer) is
'Canonical complete social feed. Returns full immutable snapshots and gives each visible author one placement before repeats.';

revoke all on function public.get_profile_feed(integer, integer) from public;
grant execute on function public.get_profile_feed(integer, integer)
  to authenticated;

-- Older posts predate the appearance snapshot contract. Fill only missing
-- appearance from the exact source flow owned by the same account.
update public.flow_posts fp
set ai_metadata = jsonb_set(
  coalesce(fp.ai_metadata, '{}'::jsonb),
  '{payload}',
  jsonb_set(
    coalesce(fp.ai_metadata -> 'payload', '{}'::jsonb),
    '{appearance}',
    source_flow.appearance,
    true
  ),
  true
)
from public.flows source_flow
where fp.flow_id = source_flow.id
  and fp.user_id = source_flow.user_id
  and fp.ai_metadata #> '{payload,appearance}' is null
  and source_flow.appearance is not null
  and source_flow.appearance <> '{}'::jsonb;

-- Add appearance to the canonical filing row itself. This removes the
-- client's second flows-table read, which was the source of image loss under
-- load and made one My Flows page depend on two data authorities.
drop function if exists public.get_my_filed_flows_v1(integer);

create function public.get_my_filed_flows_v1(
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
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

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
  ),
  flow_ids as materialized (
    select array_agg(f.id order by f.id)::bigint[] as ids
    from flow_rows f
  ),
  activity as materialized (
    select summary.*
    from flow_ids
    cross join lateral private.flow_activity_summary_v1(
      v_uid,
      flow_ids.ids
    ) summary
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
    (
      f.filed_is_saved
      and coalesce(f.is_reminder, false) = false
      and f.record_kind in ('active', 'inactive')
    ) as visible_in_saved_list,
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
  order by f.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.get_my_filed_flows_v1(integer) from public;
revoke all on function public.get_my_filed_flows_v1(integer) from anon;
grant execute on function public.get_my_filed_flows_v1(integer)
  to authenticated;

comment on function public.get_my_filed_flows_v1(integer) is
'Canonical authenticated My Flows filing rows, including appearance, backed by one bounded set-based activity pass.';

notify pgrst, 'reload schema';

commit;
