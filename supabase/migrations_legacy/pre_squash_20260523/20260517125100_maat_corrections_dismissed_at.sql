alter table public.maat_corrections
  add column if not exists dismissed_at timestamptz;
