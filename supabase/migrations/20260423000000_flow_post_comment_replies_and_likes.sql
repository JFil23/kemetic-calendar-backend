alter table public.flow_post_comments
  add column if not exists parent_comment_id uuid references public.flow_post_comments(id) on delete cascade;

create index if not exists flow_post_comments_parent_created_idx
  on public.flow_post_comments(parent_comment_id, created_at);

create table if not exists public.flow_post_comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.flow_post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint flow_post_comment_likes_unique unique (comment_id, user_id)
);

alter table public.flow_post_comment_likes enable row level security;

drop policy if exists "Anyone can view flow post comment likes" on public.flow_post_comment_likes;
create policy "Anyone can view flow post comment likes"
  on public.flow_post_comment_likes
  for select
  using (true);

drop policy if exists "Users can like flow post comments" on public.flow_post_comment_likes;
create policy "Users can like flow post comments"
  on public.flow_post_comment_likes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their flow post comment likes" on public.flow_post_comment_likes;
create policy "Users can remove their flow post comment likes"
  on public.flow_post_comment_likes
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists flow_post_comment_likes_comment_created_idx
  on public.flow_post_comment_likes(comment_id, created_at desc);
