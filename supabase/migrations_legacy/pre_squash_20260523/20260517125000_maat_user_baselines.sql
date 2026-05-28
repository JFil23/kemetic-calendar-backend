-- Per-user Ma'at baseline snapshots for L5 personal-model maturity.

create table if not exists public.maat_user_baselines (
  user_id uuid primary key references auth.users(id) on delete cascade,
  computed_at timestamptz not null default now(),
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_maat_user_baselines_computed_at
  on public.maat_user_baselines (computed_at desc);

drop trigger if exists trg_touch_maat_user_baselines
  on public.maat_user_baselines;
create trigger trg_touch_maat_user_baselines
  before update on public.maat_user_baselines
  for each row
  execute function public.touch_updated_at();

alter table public.maat_user_baselines enable row level security;

drop policy if exists "maat_user_baselines owner select"
  on public.maat_user_baselines;
create policy "maat_user_baselines owner select"
  on public.maat_user_baselines
  for select
  using (auth.uid() = user_id);

grant all on table public.maat_user_baselines
  to anon, authenticated, service_role;
