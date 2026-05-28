alter table public.profiles
  add column if not exists avatar_glyphs jsonb not null default '[]'::jsonb;

update public.profiles
set avatar_glyphs = '[]'::jsonb
where avatar_glyphs is null;

alter table public.profiles
  drop constraint if exists profiles_avatar_glyphs_is_array;

alter table public.profiles
  add constraint profiles_avatar_glyphs_is_array
  check (jsonb_typeof(avatar_glyphs) = 'array');

create or replace view public.profile_stats as
select
  p.id,
  p.handle,
  p.display_name,
  p.avatar_url,
  p.bio,
  p.location,
  p.is_discoverable,
  p.allow_incoming_shares,
  p.created_at,
  p.updated_at,
  count(distinct f.id) filter (where f.active is true) as active_flows_count,
  count(distinct ue.id) as total_flow_events_count,
  coalesce(followers.cnt, 0) as followers_count,
  coalesce(following.cnt, 0) as following_count,
  p.avatar_glyphs
from public.profiles p
left join public.flows f on f.user_id = p.id
left join public.user_events ue on ue.flow_local_id = f.id and ue.user_id = p.id
left join lateral (
  select count(*)::bigint as cnt
  from public.follows fo
  where fo.followee_id = p.id
) followers on true
left join lateral (
  select count(*)::bigint as cnt
  from public.follows fo
  where fo.follower_id = p.id
) following on true
group by p.id, followers.cnt, following.cnt;

notify pgrst, 'reload schema';
