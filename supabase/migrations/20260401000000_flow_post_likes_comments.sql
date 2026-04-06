-- Likes for flow posts on profile pages
create table if not exists public.flow_post_likes (
  id uuid primary key default gen_random_uuid(),
  flow_post_id uuid not null references public.flow_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint flow_post_likes_unique unique (flow_post_id, user_id)
);

alter table public.flow_post_likes enable row level security;

drop policy if exists "Anyone can view flow post likes" on public.flow_post_likes;
create policy "Anyone can view flow post likes"
  on public.flow_post_likes
  for select
  using (true);

drop policy if exists "Users can like flow posts" on public.flow_post_likes;
create policy "Users can like flow posts"
  on public.flow_post_likes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their flow post likes" on public.flow_post_likes;
create policy "Users can remove their flow post likes"
  on public.flow_post_likes
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists flow_post_likes_post_created_idx
  on public.flow_post_likes(flow_post_id, created_at desc);

-- Comments on flow posts (150 char limit enforced via check)
create table if not exists public.flow_post_comments (
  id uuid primary key default gen_random_uuid(),
  flow_post_id uuid not null references public.flow_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint flow_post_comments_body_length check (char_length(body) <= 150)
);

alter table public.flow_post_comments enable row level security;

drop policy if exists "Anyone can view flow post comments" on public.flow_post_comments;
create policy "Anyone can view flow post comments"
  on public.flow_post_comments
  for select
  using (true);

drop policy if exists "Users can comment on flow posts" on public.flow_post_comments;
create policy "Users can comment on flow posts"
  on public.flow_post_comments
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their flow post comments" on public.flow_post_comments;
create policy "Users can remove their flow post comments"
  on public.flow_post_comments
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists flow_post_comments_post_created_idx
  on public.flow_post_comments(flow_post_id, created_at);
