create table if not exists public.decan_reflection_prompt_interactions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decan_start date not null,
  decan_end date,
  interaction_kind text not null default 'interacted',
  interacted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint decan_reflection_prompt_interactions_pkey primary key (id),
  constraint decan_reflection_prompt_interactions_user_start_key unique (
    user_id,
    decan_start
  ),
  constraint decan_reflection_prompt_interactions_kind_check check (
    interaction_kind in ('interacted', 'dismissed', 'archived')
  )
);

create index if not exists idx_decan_reflection_prompt_interactions_user
  on public.decan_reflection_prompt_interactions (user_id, decan_start desc);

alter table public.decan_reflection_prompt_interactions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'decan_reflection_prompt_interactions'
      and policyname = 'decan_reflection_prompt_interactions_select_own'
  ) then
    create policy decan_reflection_prompt_interactions_select_own
      on public.decan_reflection_prompt_interactions
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'decan_reflection_prompt_interactions'
      and policyname = 'decan_reflection_prompt_interactions_insert_own'
  ) then
    create policy decan_reflection_prompt_interactions_insert_own
      on public.decan_reflection_prompt_interactions
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'decan_reflection_prompt_interactions'
      and policyname = 'decan_reflection_prompt_interactions_update_own'
  ) then
    create policy decan_reflection_prompt_interactions_update_own
      on public.decan_reflection_prompt_interactions
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

drop trigger if exists trg_touch_decan_reflection_prompt_interactions
  on public.decan_reflection_prompt_interactions;

create trigger trg_touch_decan_reflection_prompt_interactions
  before update on public.decan_reflection_prompt_interactions
  for each row
  execute function public.touch_updated_at();

grant all on table public.decan_reflection_prompt_interactions to anon;
grant all on table public.decan_reflection_prompt_interactions to authenticated;
grant all on table public.decan_reflection_prompt_interactions to service_role;
