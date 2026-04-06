-- Track onboarding completion per user (once per account)
alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.onboarding_completed_at is 'Timestamp when the user finished onboarding (v1).';

create index if not exists profiles_onboarding_completed_at_idx
  on public.profiles(onboarding_completed_at);
