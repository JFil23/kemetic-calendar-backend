-- Follow the Sky encounter state. Calendar scheduling and catalog astronomy
-- remain authoritative in their existing tables/assets.
create table if not exists public.follow_sky_turning_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  sky_event_id text not null,
  intention_snapshot text,
  reflection_text text not null default '',
  photo_object_path text,
  completion_status text check (
    completion_status is null
    or completion_status in ('observed', 'partly', 'skipped')
  ),
  started_at timestamptz not null,
  last_edited_at timestamptz not null,
  completed_at timestamptz,
  scheduled_time_snapshot timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index if not exists follow_sky_turning_records_user_sky_idx
  on public.follow_sky_turning_records (user_id, sky_event_id);

alter table public.follow_sky_turning_records enable row level security;

revoke all on table public.follow_sky_turning_records from anon;
grant select, insert, update, delete
  on table public.follow_sky_turning_records to authenticated;

create policy "turning records are readable by their owner"
  on public.follow_sky_turning_records
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "turning records are insertable by their owner"
  on public.follow_sky_turning_records
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "turning records are editable by their owner"
  on public.follow_sky_turning_records
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "turning records are deletable by their owner"
  on public.follow_sky_turning_records
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'follow-sky-turnings',
  'follow-sky-turnings',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "turning photos are readable by their owner"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'follow-sky-turnings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "turning photos are insertable by their owner"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'follow-sky-turnings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "turning photos are editable by their owner"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'follow-sky-turnings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'follow-sky-turnings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "turning photos are deletable by their owner"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'follow-sky-turnings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
