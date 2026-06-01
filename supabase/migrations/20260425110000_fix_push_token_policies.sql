-- Align push_tokens RLS with the live schema so device registration and
-- unregister flows work in fresh environments as well as production.

alter table public.push_tokens enable row level security;

drop policy if exists insert_own_push_token on public.push_tokens;
drop policy if exists update_own_push_token on public.push_tokens;
drop policy if exists select_own_push_token on public.push_tokens;
drop policy if exists delete_own_push_token on public.push_tokens;
drop policy if exists "push_tokens insert own" on public.push_tokens;
drop policy if exists "push_tokens update own" on public.push_tokens;
drop policy if exists "push_tokens select own" on public.push_tokens;
drop policy if exists "push_tokens delete own" on public.push_tokens;

create policy "push_tokens insert own"
on public.push_tokens
for insert
with check (((select auth.uid() as uid) = user_id));

create policy "push_tokens update own"
on public.push_tokens
for update
using (((select auth.uid() as uid) = user_id))
with check (((select auth.uid() as uid) = user_id));

create policy "push_tokens select own"
on public.push_tokens
for select
using (((select auth.uid() as uid) = user_id));

create policy "push_tokens delete own"
on public.push_tokens
for delete
using (((select auth.uid() as uid) = user_id));

create index if not exists push_tokens_active_idx
on public.push_tokens (is_active)
where (is_active = true);
