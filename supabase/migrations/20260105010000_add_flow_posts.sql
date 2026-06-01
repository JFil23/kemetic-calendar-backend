-- Flow posts allow users to publish flows on their profile.
create table if not exists public.flow_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  flow_id bigint,
  name text not null,
  color bigint not null default 0,
  notes text,
  rules jsonb not null default '[]',
  start_date date,
  end_date date,
  is_hidden boolean not null default false,
  ai_metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

comment on column public.flow_posts.flow_id is 'Optional pointer to the original flow (for auditing only)';

alter table public.flow_posts enable row level security;

drop policy if exists "Anyone can view flow posts" on public.flow_posts;
create policy "Anyone can view flow posts"
  on public.flow_posts
  for select
  using (true);

drop policy if exists "Users can create their own flow posts" on public.flow_posts;
create policy "Users can create their own flow posts"
  on public.flow_posts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Owners can delete their flow posts" on public.flow_posts;
create policy "Owners can delete their flow posts"
  on public.flow_posts
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists flow_posts_user_id_created_at_idx
  on public.flow_posts(user_id, created_at desc);
