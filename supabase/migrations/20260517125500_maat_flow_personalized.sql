-- Ma'at personalized-flow bridge.
-- Deterministic briefs are created at evaluate time; AI flow generation still
-- happens only after the user accepts the preview.

alter table public.maat_guidance_deliveries
  drop constraint if exists maat_guidance_deliveries_cta_type_check;

alter table public.maat_guidance_deliveries
  add constraint maat_guidance_deliveries_cta_type_check
  check (
    cta_type in (
      'none',
      'node',
      'flow',
      'flow_template',
      'flow_personalized'
    )
  );

create table if not exists public.maat_flow_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decan_period_key text not null,
  delivery_id uuid references public.maat_guidance_deliveries(id) on delete set null,
  brief_id text not null,
  policy_version text not null default 'maat_flow_brief_v1',
  brief jsonb not null default '{}'::jsonb,
  fingerprint jsonb not null default '{}'::jsonb,
  fallback_template_key text,
  generated_at timestamptz,
  generation_id uuid,
  flow_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, decan_period_key, brief_id)
);

create index if not exists idx_maat_flow_briefs_delivery
  on public.maat_flow_briefs (delivery_id);

create index if not exists idx_maat_flow_briefs_user_period
  on public.maat_flow_briefs (user_id, decan_period_key);

drop trigger if exists trg_touch_maat_flow_briefs
  on public.maat_flow_briefs;
create trigger trg_touch_maat_flow_briefs
  before update on public.maat_flow_briefs
  for each row execute function public.touch_updated_at();

alter table public.maat_flow_briefs enable row level security;

drop policy if exists "maat_flow_briefs owner select"
  on public.maat_flow_briefs;
create policy "maat_flow_briefs owner select"
  on public.maat_flow_briefs
  for select using (auth.uid() = user_id);

grant all on table public.maat_flow_briefs to anon, authenticated, service_role;
