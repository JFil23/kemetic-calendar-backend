-- Create push_tokens table to persist device tokens for FCM fan-out.
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null unique,
  platform text not null,
  token text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'push_tokens' and policyname = 'insert_own_push_token'
  ) then
    create policy insert_own_push_token on public.push_tokens
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'push_tokens' and policyname = 'update_own_push_token'
  ) then
    create policy update_own_push_token on public.push_tokens
      for update using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'push_tokens' and policyname = 'select_own_push_token'
  ) then
    create policy select_own_push_token on public.push_tokens
      for select using (auth.uid() = user_id);
  end if;
end
$$;

create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);
