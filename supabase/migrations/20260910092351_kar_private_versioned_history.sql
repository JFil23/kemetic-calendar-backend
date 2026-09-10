-- One permanent, private Kꜣr per user and netjer. The versioned lifecycle is
-- stored as an opaque document so application-preserved scene lineage can
-- advance without exposing historical versions as independently writable rows.
create table public.kar_shrines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  netjer_key text not null check (
    netjer_key in ('djehuty', 'maat', 'sekhmet', 'hetheru', 'khepri', 'ptah')
  ),
  state jsonb not null default '{"active_cycle_id":null,"cycles":[],"drafts":{}}'::jsonb
    check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, netjer_key)
);

create index kar_shrines_user_updated_idx
  on public.kar_shrines (user_id, updated_at desc);

alter table public.kar_shrines enable row level security;

create policy "kar_shrines_select_own"
  on public.kar_shrines
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "kar_shrines_insert_own"
  on public.kar_shrines
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "kar_shrines_update_own"
  on public.kar_shrines
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.kar_shrines from anon;
revoke all on table public.kar_shrines from authenticated;
grant select, insert on table public.kar_shrines to authenticated;
grant update (state, revision, updated_at)
  on table public.kar_shrines
  to authenticated;

comment on table public.kar_shrines is
  'Private Kꜣr lifecycle documents. One permanent shrine per user/netjer; no delete grant.';
comment on column public.kar_shrines.state is
  'Application-preserved version history for cycles, scenes, drafts, walks, and the active-cycle pointer.';
comment on column public.kar_shrines.revision is
  'Optimistic-concurrency revision; clients update only when their loaded revision matches.';
