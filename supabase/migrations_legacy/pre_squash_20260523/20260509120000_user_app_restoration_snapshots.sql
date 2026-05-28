-- Durable user continuity snapshots for exact-return app restoration.
create table if not exists public.user_app_restoration_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null,
  device_id text not null default '',
  window_id text not null default '',
  snapshot jsonb not null,
  schema_version integer not null,
  route_location text,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_app_restoration_snapshots_pk
    primary key (user_id, scope, device_id, window_id),
  constraint user_app_restoration_snapshots_scope_check
    check (scope in ('window', 'latest')),
  constraint user_app_restoration_snapshots_snapshot_object_check
    check (jsonb_typeof(snapshot) = 'object')
);

alter table public.user_app_restoration_snapshots enable row level security;

drop policy if exists "user_app_restoration_select_own"
  on public.user_app_restoration_snapshots;
create policy "user_app_restoration_select_own"
  on public.user_app_restoration_snapshots
  for select
  to authenticated
  using (((select auth.uid()) = user_id));

drop policy if exists "user_app_restoration_insert_own"
  on public.user_app_restoration_snapshots;
create policy "user_app_restoration_insert_own"
  on public.user_app_restoration_snapshots
  for insert
  to authenticated
  with check (((select auth.uid()) = user_id));

drop policy if exists "user_app_restoration_update_own"
  on public.user_app_restoration_snapshots;
create policy "user_app_restoration_update_own"
  on public.user_app_restoration_snapshots
  for update
  to authenticated
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

drop policy if exists "user_app_restoration_delete_own"
  on public.user_app_restoration_snapshots;
create policy "user_app_restoration_delete_own"
  on public.user_app_restoration_snapshots
  for delete
  to authenticated
  using (((select auth.uid()) = user_id));

create index if not exists user_app_restoration_user_updated_idx
  on public.user_app_restoration_snapshots (user_id, updated_at desc);

create index if not exists user_app_restoration_user_scope_updated_idx
  on public.user_app_restoration_snapshots (user_id, scope, updated_at desc);

grant select, insert, update, delete
  on public.user_app_restoration_snapshots
  to authenticated;
