-- Admin Content Lab
-- Staff-gated previews and operator critiques for decan reflections,
-- decan openings, Ma'at / Isfet nudges, and push packaging.

create table if not exists public.admin_content_evaluations (
  id uuid primary key default gen_random_uuid(),
  artifact text not null,
  mode text not null default 'preview',
  status text not null default 'draft',
  actor_user_id uuid null references auth.users(id) on delete set null,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  window_start date null,
  window_end date null,
  decan_period_key text null,
  generated_text text null,
  push_preview jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  model_version text null,
  rating integer null,
  feedback_tags text[] not null default '{}'::text[],
  critique_md text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint admin_content_evaluations_artifact_check check (
    artifact in (
      'decan_reflection',
      'decan_opening',
      'maat_nudge',
      'isfet_nudge',
      'push_preview'
    )
  ),
  constraint admin_content_evaluations_mode_check check (
    mode in ('preview', 'test_push', 'live_repair')
  ),
  constraint admin_content_evaluations_status_check check (
    status in ('draft', 'reviewed', 'golden', 'needs_work', 'discarded')
  ),
  constraint admin_content_evaluations_rating_check check (
    rating is null or (rating >= 1 and rating <= 5)
  ),
  constraint admin_content_evaluations_feedback_tags_no_null check (
    array_position(feedback_tags, null) is null
  )
);

comment on table public.admin_content_evaluations is
  'Operator Content Lab previews and critiques. Stores generated copy, sanitized evidence snapshots, and staff feedback for regression comparison.';
comment on column public.admin_content_evaluations.source_snapshot is
  'Sanitized generation context and evidence counts. Keep full private journal text out unless a break-glass workflow explicitly permits it.';
comment on column public.admin_content_evaluations.push_preview is
  'Notification title/body/deeplink preview. Test pushes must target staff devices only and require explicit future handling.';

create index if not exists admin_content_evaluations_target_created_idx
  on public.admin_content_evaluations(target_user_id, created_at desc);
create index if not exists admin_content_evaluations_artifact_created_idx
  on public.admin_content_evaluations(artifact, created_at desc);
create index if not exists admin_content_evaluations_status_created_idx
  on public.admin_content_evaluations(status, created_at desc);
create index if not exists admin_content_evaluations_period_idx
  on public.admin_content_evaluations(decan_period_key)
  where decan_period_key is not null;

create or replace function public.set_admin_content_evaluations_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists admin_content_evaluations_updated_at
  on public.admin_content_evaluations;
create trigger admin_content_evaluations_updated_at
before update on public.admin_content_evaluations
for each row execute function public.set_admin_content_evaluations_updated_at();

alter table public.admin_content_evaluations enable row level security;

revoke all on table public.admin_content_evaluations from anon, authenticated;
grant all on table public.admin_content_evaluations to service_role;

revoke all on function public.set_admin_content_evaluations_updated_at()
  from public;
grant execute on function public.set_admin_content_evaluations_updated_at()
  to service_role;

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
      'product.content.read',
      'product.content.test',
      'product.content.write',
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

revoke all on function public.staff_has_scope(uuid, text) from public;
grant execute on function public.staff_has_scope(uuid, text)
  to authenticated, service_role;
