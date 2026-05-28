-- Create follows table to track user relationships
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint follows_pkey primary key (follower_id, followee_id),
  constraint follows_no_self check (follower_id <> followee_id)
);

alter table public.follows enable row level security;

create policy "Users can follow others"
  on public.follows
  for insert
  to authenticated
  with check ((auth.uid() = follower_id) and follower_id <> followee_id);

create policy "Users can unfollow"
  on public.follows
  for delete
  to authenticated
  using (auth.uid() = follower_id);

create policy "Anyone can view follows"
  on public.follows
  for select
  using (true);

create index if not exists follows_followee_id_idx on public.follows (followee_id);
create index if not exists follows_follower_id_idx on public.follows (follower_id);

-- Extend profile_stats view with follower/following counts
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
  coalesce(following.cnt, 0) as following_count
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
