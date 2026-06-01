create table if not exists public.dm_message_likes (
  id uuid primary key default gen_random_uuid(),
  message_share_id uuid not null references public.flow_shares(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint dm_message_likes_unique unique (message_share_id, user_id)
);

alter table public.dm_message_likes enable row level security;

drop policy if exists "Conversation participants can view dm message likes"
  on public.dm_message_likes;
create policy "Conversation participants can view dm message likes"
  on public.dm_message_likes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.flow_shares fs
      where fs.id = dm_message_likes.message_share_id
        and (fs.sender_id = auth.uid() or fs.recipient_id = auth.uid())
        and coalesce(fs.payload_json ->> 'type', fs.payload_json ->> 'kind') = 'message'
    )
  );

drop policy if exists "Conversation participants can like dm messages"
  on public.dm_message_likes;
create policy "Conversation participants can like dm messages"
  on public.dm_message_likes
  for insert
  to authenticated
  with check (
    auth.uid() = user_id and
    exists (
      select 1
      from public.flow_shares fs
      where fs.id = dm_message_likes.message_share_id
        and (fs.sender_id = auth.uid() or fs.recipient_id = auth.uid())
        and coalesce(fs.payload_json ->> 'type', fs.payload_json ->> 'kind') = 'message'
    )
  );

drop policy if exists "Users can remove their dm message likes"
  on public.dm_message_likes;
create policy "Users can remove their dm message likes"
  on public.dm_message_likes
  for delete
  to authenticated
  using (
    auth.uid() = user_id and
    exists (
      select 1
      from public.flow_shares fs
      where fs.id = dm_message_likes.message_share_id
        and (fs.sender_id = auth.uid() or fs.recipient_id = auth.uid())
        and coalesce(fs.payload_json ->> 'type', fs.payload_json ->> 'kind') = 'message'
    )
  );

create index if not exists dm_message_likes_message_created_idx
  on public.dm_message_likes(message_share_id, created_at desc);
