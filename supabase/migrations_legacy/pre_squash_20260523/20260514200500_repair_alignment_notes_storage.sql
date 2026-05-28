-- Planner notes storage repair.
-- Keeps existing notes intact, creates the table when an environment missed
-- the original migration, and ensures authenticated users have API access.

create table if not exists public.alignment_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.alignment_notes enable row level security;

create index if not exists alignment_notes_user_created_idx
  on public.alignment_notes(user_id, position, created_at);

grant select, insert, update, delete on public.alignment_notes to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'alignment_notes'
      and policyname = 'alignment_notes_owner'
  ) then
    create policy alignment_notes_owner
      on public.alignment_notes
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

drop trigger if exists trg_touch_alignment_notes on public.alignment_notes;
create trigger trg_touch_alignment_notes
  before update on public.alignment_notes
  for each row execute function public.touch_updated_at();
