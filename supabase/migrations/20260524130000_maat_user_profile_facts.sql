create table if not exists public.maat_user_profile_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fact_type text not null,
  value text not null,
  source text not null,
  confidence text not null default 'low',
  evidence_count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  stability text not null default 'emerging',
  counterevidence text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maat_user_profile_facts_fact_type_check check (
    fact_type in (
      'role_context',
      'work_domain',
      'routine_style',
      'record_style',
      'capacity_state',
      'care_direction',
      'commitment_pattern',
      'guidance_response',
      'offering_fit',
      'register_affinity',
      'completion_timing',
      'practice_trajectory'
    )
  ),
  constraint maat_user_profile_facts_confidence_check check (
    confidence in ('low', 'medium', 'high')
  ),
  constraint maat_user_profile_facts_stability_check check (
    stability in ('emerging', 'stable', 'shifting', 'contradicted')
  ),
  constraint maat_user_profile_facts_evidence_count_check check (
    evidence_count >= 0
  )
);

create unique index if not exists idx_maat_user_profile_facts_user_type_value
  on public.maat_user_profile_facts (user_id, fact_type, value);

create index if not exists idx_maat_user_profile_facts_user_type
  on public.maat_user_profile_facts (user_id, fact_type, last_seen desc);

create index if not exists idx_maat_user_profile_facts_user_confidence
  on public.maat_user_profile_facts (user_id, confidence, stability);

alter table public.maat_user_profile_facts enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'maat_user_profile_facts'
      and policyname = 'maat_user_profile_facts_select_own'
  ) then
    create policy maat_user_profile_facts_select_own
      on public.maat_user_profile_facts
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'maat_user_profile_facts'
      and policyname = 'maat_user_profile_facts_insert_own'
  ) then
    create policy maat_user_profile_facts_insert_own
      on public.maat_user_profile_facts
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'maat_user_profile_facts'
      and policyname = 'maat_user_profile_facts_update_own'
  ) then
    create policy maat_user_profile_facts_update_own
      on public.maat_user_profile_facts
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'maat_user_profile_facts'
      and policyname = 'maat_user_profile_facts_delete_own'
  ) then
    create policy maat_user_profile_facts_delete_own
      on public.maat_user_profile_facts
      for delete
      using (auth.uid() = user_id);
  end if;
end $$;

drop trigger if exists trg_touch_maat_user_profile_facts
  on public.maat_user_profile_facts;

create trigger trg_touch_maat_user_profile_facts
  before update on public.maat_user_profile_facts
  for each row
  execute function public.touch_updated_at();

grant select, insert, update, delete on public.maat_user_profile_facts
  to authenticated;

grant select, insert, update, delete on public.maat_user_profile_facts
  to service_role;

comment on table public.maat_user_profile_facts is
'Durable typed Ma''at user profile facts used to personalize reflections without exposing raw activity or treating a single decan as identity.';
