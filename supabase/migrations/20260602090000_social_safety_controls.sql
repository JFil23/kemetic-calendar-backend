create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_blocks_unique unique (blocker_user_id, blocked_user_id),
  constraint user_blocks_no_self check (blocker_user_id <> blocked_user_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "Users can read their own blocks" on public.user_blocks;
create policy "Users can read their own blocks"
  on public.user_blocks
  for select
  to authenticated
  using (auth.uid() = blocker_user_id);

drop policy if exists "Users can create their own blocks" on public.user_blocks;
create policy "Users can create their own blocks"
  on public.user_blocks
  for insert
  to authenticated
  with check (auth.uid() = blocker_user_id);

drop policy if exists "Users can delete their own blocks" on public.user_blocks;
create policy "Users can delete their own blocks"
  on public.user_blocks
  for delete
  to authenticated
  using (auth.uid() = blocker_user_id);

create index if not exists user_blocks_blocker_created_idx
  on public.user_blocks(blocker_user_id, created_at desc);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks(blocked_user_id);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null,
  content_id uuid not null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reason text not null default 'other',
  details text,
  status text not null default 'open',
  created_at timestamptz not null default timezone('utc', now()),
  constraint content_reports_content_type_check check (
    content_type in ('flow_post', 'flow_post_comment', 'insight_post', 'profile')
  ),
  constraint content_reports_reason_check check (char_length(reason) between 1 and 80),
  constraint content_reports_details_check check (
    details is null or char_length(details) <= 1000
  ),
  constraint content_reports_status_check check (
    status in ('open', 'reviewing', 'actioned', 'dismissed')
  )
);

alter table public.content_reports enable row level security;

drop policy if exists "Users can create their own reports" on public.content_reports;
create policy "Users can create their own reports"
  on public.content_reports
  for insert
  to authenticated
  with check (auth.uid() = reporter_user_id);

drop policy if exists "Users can read their own reports" on public.content_reports;
create policy "Users can read their own reports"
  on public.content_reports
  for select
  to authenticated
  using (auth.uid() = reporter_user_id);

create index if not exists content_reports_status_created_idx
  on public.content_reports(status, created_at desc);

create index if not exists content_reports_reporter_created_idx
  on public.content_reports(reporter_user_id, created_at desc);

create index if not exists content_reports_content_idx
  on public.content_reports(content_type, content_id);

drop policy if exists "Anyone can view flow posts" on public.flow_posts;
drop policy if exists "Public can view visible flow posts" on public.flow_posts;
drop policy if exists "Users can view unblocked flow posts" on public.flow_posts;
create policy "Users can view unblocked flow posts"
  on public.flow_posts
  for select
  using (
    (
      coalesce(is_hidden, false) = false
      or user_id = auth.uid()
    )
    and (
      auth.uid() is null
      or user_id = auth.uid()
      or not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = auth.uid()
          and b.blocked_user_id = flow_posts.user_id
      )
    )
  );

drop policy if exists "Anyone can view insight posts" on public.insight_posts;
drop policy if exists "Users can view unblocked insight posts" on public.insight_posts;
create policy "Users can view unblocked insight posts"
  on public.insight_posts
  for select
  using (
    (
      coalesce(is_hidden, false) = false
      or user_id = auth.uid()
    )
    and (
      auth.uid() is null
      or user_id = auth.uid()
      or not exists (
        select 1
        from public.user_blocks b
        where b.blocker_user_id = auth.uid()
          and b.blocked_user_id = insight_posts.user_id
      )
    )
  );

drop policy if exists "Anyone can view flow post comments" on public.flow_post_comments;
drop policy if exists "Users can view unblocked flow post comments" on public.flow_post_comments;
create policy "Users can view unblocked flow post comments"
  on public.flow_post_comments
  for select
  using (
    auth.uid() is null
    or user_id = auth.uid()
    or not exists (
      select 1
      from public.user_blocks b
      where b.blocker_user_id = auth.uid()
        and b.blocked_user_id = flow_post_comments.user_id
    )
  );
