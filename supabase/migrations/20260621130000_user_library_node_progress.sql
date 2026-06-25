create extension if not exists pgcrypto;

create table if not exists public.user_library_node_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id text not null,
  progress_percent double precision not null default 0,
  last_scroll_offset double precision not null default 0,
  last_read_at timestamptz,
  completed_at timestamptz,
  bookmarked_at timestamptz,
  bookmark_scroll_offset double precision,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_library_node_progress_user_node_unique unique (user_id, node_id),
  constraint user_library_node_progress_percent_check
    check (progress_percent >= 0 and progress_percent <= 1),
  constraint user_library_node_progress_offset_check
    check (last_scroll_offset >= 0),
  constraint user_library_node_progress_bookmark_offset_check
    check (bookmark_scroll_offset is null or bookmark_scroll_offset >= 0),
  constraint user_library_node_progress_node_id_check
    check (length(btrim(node_id)) > 0)
);

create index if not exists user_library_node_progress_user_updated_idx
  on public.user_library_node_progress (user_id, updated_at desc);

create or replace function public.set_user_library_node_progress_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.completed_at is not null then
      new.completed_at := old.completed_at;
      new.progress_percent := 1;
    elsif new.completed_at is not null then
      new.progress_percent := 1;
    end if;
  elsif new.completed_at is not null then
    new.progress_percent := 1;
  end if;

  new.node_id := btrim(new.node_id);
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_user_library_node_progress_updated_at
  on public.user_library_node_progress;

create trigger set_user_library_node_progress_updated_at
before insert or update on public.user_library_node_progress
for each row
execute function public.set_user_library_node_progress_updated_at();

alter table public.user_library_node_progress enable row level security;

drop policy if exists "Users can select own library progress"
  on public.user_library_node_progress;
create policy "Users can select own library progress"
  on public.user_library_node_progress
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert own library progress"
  on public.user_library_node_progress;
create policy "Users can insert own library progress"
  on public.user_library_node_progress
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update own library progress"
  on public.user_library_node_progress;
create policy "Users can update own library progress"
  on public.user_library_node_progress
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.user_library_node_progress to authenticated;
