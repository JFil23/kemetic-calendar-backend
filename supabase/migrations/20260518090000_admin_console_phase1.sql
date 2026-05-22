-- ḥꜣw Admin / Operator Console - Phase 1
-- Staff RBAC and operator audit log.

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  scopes text[] not null default '{}'::text[],
  is_active boolean not null default true,
  invited_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint staff_members_role_check check (
    role in ('owner', 'operator', 'support', 'readonly')
  ),
  constraint staff_members_scopes_no_null check (
    array_position(scopes, null) is null
  )
);

comment on table public.staff_members is
  'Private admin/operator RBAC. Do not reuse user-facing profile or calendar roles.';
comment on column public.staff_members.scopes is
  'Fine-grained admin scopes. Owners are treated as full-scope by staff_has_scope for known scopes.';

create index if not exists staff_members_role_active_idx
  on public.staff_members(role, is_active);

create or replace function public.set_staff_members_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists staff_members_updated_at on public.staff_members;
create trigger staff_members_updated_at
before update on public.staff_members
for each row execute function public.set_staff_members_updated_at();

alter table public.staff_members enable row level security;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default timezone('utc', now()),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_role text null,
  action text not null,
  resource_type text null,
  resource_id text null,
  risk_level text not null default 'low',
  metadata jsonb not null default '{}'::jsonb,
  ip text null,
  user_agent text null,
  request_id text null,
  environment text null,
  constraint admin_audit_log_risk_level_check check (
    risk_level in ('low', 'medium', 'high', 'restricted')
  )
);

comment on table public.admin_audit_log is
  'Append-only operator audit stream for admin access, approvals, agent runs, data access, and settings changes.';
comment on column public.admin_audit_log.metadata is
  'Sanitized JSON metadata. Do not store raw PII or private user content unless a break-glass workflow explicitly permits it.';

create index if not exists admin_audit_log_at_idx
  on public.admin_audit_log(at desc);
create index if not exists admin_audit_log_actor_at_idx
  on public.admin_audit_log(actor_user_id, at desc);
create index if not exists admin_audit_log_action_at_idx
  on public.admin_audit_log(action, at desc);
create index if not exists admin_audit_log_resource_idx
  on public.admin_audit_log(resource_type, resource_id);
create index if not exists admin_audit_log_request_id_idx
  on public.admin_audit_log(request_id)
  where request_id is not null;

alter table public.admin_audit_log enable row level security;

create or replace function public._staff_check_allowed(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_uid = auth.uid(), false)
    or current_setting('request.jwt.claims.role', true) = 'service_role';
$$;

create or replace function public.is_staff(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._staff_check_allowed(p_uid)
    and exists (
      select 1
      from public.staff_members sm
      where sm.user_id = p_uid
        and sm.is_active = true
    );
$$;

create or replace function public.staff_has_scope(
  p_uid uuid,
  p_scope text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with known_scopes(scope) as (
    select unnest(array[
      'war_room.read',
      'product.read',
      'product.users.read',
      'product.users.support',
      'product.nodes.read',
      'product.nodes.write',
      'product.maat.read',
      'product.maat.write',
      'ops.read',
      'ops.run',
      'ops.approve',
      'archive.read',
      'archive.write',
      'armory.read',
      'armory.write',
      'approvals.read',
      'approvals.decide',
      'treasury.read',
      'treasury.write',
      'settings.staff.read',
      'settings.staff.write',
      'security.break_glass'
    ]::text[])
  )
  select public._staff_check_allowed(p_uid)
    and exists (select 1 from known_scopes ks where ks.scope = p_scope)
    and exists (
      select 1
      from public.staff_members sm
      where sm.user_id = p_uid
        and sm.is_active = true
        and (
          sm.role = 'owner'
          or p_scope = any(sm.scopes)
        )
    );
$$;

revoke all on table public.staff_members from anon, authenticated;
grant all on table public.staff_members to service_role;

revoke all on table public.admin_audit_log from anon, authenticated;
grant all on table public.admin_audit_log to service_role;

revoke all on function public._staff_check_allowed(uuid) from public;
grant execute on function public._staff_check_allowed(uuid) to service_role;

revoke all on function public.is_staff(uuid) from public;
grant execute on function public.is_staff(uuid) to authenticated, service_role;

revoke all on function public.staff_has_scope(uuid, text) from public;
grant execute on function public.staff_has_scope(uuid, text) to authenticated, service_role;
