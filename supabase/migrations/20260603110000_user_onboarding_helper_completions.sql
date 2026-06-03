create table if not exists public.user_onboarding_helper_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  helper_id text not null,
  version int not null default 1,
  completed_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, helper_id, version),
  constraint user_onboarding_helper_completions_helper_id_check
    check (length(btrim(helper_id)) > 0),
  constraint user_onboarding_helper_completions_version_check
    check (version > 0)
);

alter table public.user_onboarding_helper_completions
  enable row level security;

grant select, insert, update, delete
  on public.user_onboarding_helper_completions
  to authenticated;

drop policy if exists "Users can select own helper completions"
  on public.user_onboarding_helper_completions;
create policy "Users can select own helper completions"
  on public.user_onboarding_helper_completions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own helper completions"
  on public.user_onboarding_helper_completions;
create policy "Users can insert own helper completions"
  on public.user_onboarding_helper_completions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own helper completions"
  on public.user_onboarding_helper_completions;
create policy "Users can update own helper completions"
  on public.user_onboarding_helper_completions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own helper completions"
  on public.user_onboarding_helper_completions;
create policy "Users can delete own helper completions"
  on public.user_onboarding_helper_completions
  for delete
  to authenticated
  using (auth.uid() = user_id);
