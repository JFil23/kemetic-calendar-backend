create table if not exists public.node_insight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  body_text text not null default '',
  entry_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint node_insight_entries_body_length check (char_length(body_text) <= 12000)
);

create index if not exists node_insight_entries_user_node_date_idx
  on public.node_insight_entries(user_id, node_id, entry_date desc, created_at desc);

create index if not exists node_insight_entries_user_created_idx
  on public.node_insight_entries(user_id, created_at desc);

alter table public.node_insight_entries enable row level security;

drop policy if exists "node_insight_entries owner" on public.node_insight_entries;
create policy "node_insight_entries owner" on public.node_insight_entries
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists trg_touch_node_insight_entries on public.node_insight_entries;
create trigger trg_touch_node_insight_entries
before update on public.node_insight_entries
for each row execute procedure public.touch_updated_at();

insert into public.node_insight_entries (
  id,
  user_id,
  node_id,
  body_text,
  entry_date,
  created_at,
  updated_at
)
select
  nuc.id,
  nuc.user_id,
  nuc.node_id,
  nuc.plain_text,
  coalesce((nuc.updated_at at time zone 'utc')::date, (nuc.created_at at time zone 'utc')::date, current_date),
  nuc.created_at,
  nuc.updated_at
from public.node_user_content nuc
where btrim(coalesce(nuc.plain_text, '')) <> ''
  and not exists (
    select 1
    from public.node_insight_entries nie
    where nie.id = nuc.id
  );

create table if not exists public.insight_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  insight_entry_id uuid not null references public.node_insight_entries(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  body_text text not null,
  entry_date date not null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint insight_posts_body_length check (char_length(body_text) <= 12000),
  constraint insight_posts_unique_entry unique (user_id, insight_entry_id)
);

create index if not exists insight_posts_user_created_idx
  on public.insight_posts(user_id, created_at desc);

create index if not exists insight_posts_visible_created_idx
  on public.insight_posts(created_at desc)
  where coalesce(is_hidden, false) = false;

alter table public.insight_posts enable row level security;

drop policy if exists "Anyone can view insight posts" on public.insight_posts;
create policy "Anyone can view insight posts"
  on public.insight_posts
  for select
  using (true);

drop policy if exists "Users can create their own insight posts" on public.insight_posts;
create policy "Users can create their own insight posts"
  on public.insight_posts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Owners can update their insight posts" on public.insight_posts;
create policy "Owners can update their insight posts"
  on public.insight_posts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners can delete their insight posts" on public.insight_posts;
create policy "Owners can delete their insight posts"
  on public.insight_posts
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists trg_touch_insight_posts on public.insight_posts;
create trigger trg_touch_insight_posts
before update on public.insight_posts
for each row execute procedure public.touch_updated_at();

comment on table public.node_insight_entries is
  'Dated user-authored insight entries attached to a Kemetic node. Replaces the single-note-per-node model for UI editing while preserving node_user_content for graph aggregation.';

comment on table public.insight_posts is
  'Snapshot posts created from node insight entries for profile/feed display.';
