-- Admin / Operator Console - Phase 6
-- Ma'at operations drafts and ADR-002 interim Node CMS drafts.

create table if not exists public.maat_routing_overrides (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'global'
    check (scope in ('global', 'cta', 'cohort', 'user', 'policy')),
  status text not null default 'draft'
    check (status in (
      'draft',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled'
    )),
  cta_type text,
  cta_ref text,
  cohort_type text,
  cohort_key text,
  target_user_id uuid references auth.users(id) on delete set null,
  override jsonb not null default '{}'::jsonb,
  reason text not null,
  approval_request_id uuid references public.haw_approval_requests(id)
    on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.node_drafts (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  body_md text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in (
      'draft',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled'
    )),
  linked_node_slug text,
  approval_request_id uuid references public.haw_approval_requests(id)
    on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.node_draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.node_drafts(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  title text not null,
  body_md text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  unique (draft_id, version_number)
);

create index if not exists maat_routing_overrides_status_idx
  on public.maat_routing_overrides(status, created_at desc);
create index if not exists maat_routing_overrides_scope_idx
  on public.maat_routing_overrides(scope, status);
create index if not exists node_drafts_status_idx
  on public.node_drafts(status, created_at desc);
create index if not exists node_drafts_slug_idx
  on public.node_drafts(slug);
create index if not exists node_draft_versions_draft_idx
  on public.node_draft_versions(draft_id, version_number desc);

drop trigger if exists set_maat_routing_overrides_updated_at
  on public.maat_routing_overrides;
create trigger set_maat_routing_overrides_updated_at
before update on public.maat_routing_overrides
for each row execute function public.set_admin_runtime_updated_at();

drop trigger if exists set_node_drafts_updated_at on public.node_drafts;
create trigger set_node_drafts_updated_at
before update on public.node_drafts
for each row execute function public.set_admin_runtime_updated_at();

alter table public.maat_routing_overrides enable row level security;
alter table public.node_drafts enable row level security;
alter table public.node_draft_versions enable row level security;

revoke all on table public.maat_routing_overrides from anon, authenticated;
revoke all on table public.node_drafts from anon, authenticated;
revoke all on table public.node_draft_versions from anon, authenticated;

grant all on table public.maat_routing_overrides to service_role;
grant all on table public.node_drafts to service_role;
grant all on table public.node_draft_versions to service_role;
