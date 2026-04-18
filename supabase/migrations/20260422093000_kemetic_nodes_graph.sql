-- Kemetic Nodes + Personal Graph schema
-- Tables: nodes, node_links, node_user_content, insight_links,
--         user_choice_events, reflection_profiles, reflection_generations, reflection_feedback
-- Includes enums via check constraints, indexes, and RLS.

create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  glyph text,
  body_text text not null,
  aliases jsonb not null default '[]'::jsonb,
  node_type text not null check (node_type in ('netjer','animal','cosmic','earth','metaphysical','builder')),
  is_system_owned boolean not null default true,
  is_active boolean not null default true,
  sort_key integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_nodes_aliases on public.nodes using gin(aliases);

create table if not exists public.node_links (
  id uuid primary key default gen_random_uuid(),
  source_node_id uuid not null references public.nodes(id) on delete cascade,
  target_node_id uuid not null references public.nodes(id) on delete cascade,
  link_phrase text,
  link_type text not null default 'embedded_text' check (link_type in ('embedded_text','thematic','structural','supports','opposes','restores','measures','contains','signals','associated_with')),
  weight numeric not null default 1.0,
  created_at timestamptz not null default now()
);

create index if not exists idx_node_links_source on public.node_links(source_node_id);
create index if not exists idx_node_links_target on public.node_links(target_node_id);
create unique index if not exists uq_node_links_unique on public.node_links(source_node_id, target_node_id, coalesce(link_phrase,''), link_type);

create table if not exists public.node_user_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  plain_text text not null default '',
  rich_text_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_node_user_content unique (user_id, node_id)
);

create index if not exists idx_node_user_content_user on public.node_user_content(user_id);
create index if not exists idx_node_user_content_node on public.node_user_content(node_id);

create table if not exists public.insight_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('node_user_text','journal_entry','reflection_entry')),
  source_id uuid not null,
  source_range_start integer,
  source_range_end integer,
  source_selected_text text,
  target_type text not null check (target_type in ('node','journal_entry','reflection_entry')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_insight_links_user on public.insight_links(user_id);
create index if not exists idx_insight_links_source on public.insight_links(source_type, source_id);
create index if not exists idx_insight_links_target on public.insight_links(target_type, target_id);

create table if not exists public.user_choice_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'node_opened','node_link_tapped','node_insight_saved','journal_linked_to_node','reflection_linked_to_node',
    'node_linked_to_journal','node_linked_to_reflection','flow_completed','flow_skipped','reflection_opened',
    'reflection_saved','reflection_rated'
  )),
  node_id uuid references public.nodes(id) on delete set null,
  flow_id uuid,
  journal_entry_id uuid,
  reflection_entry_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_choice_events_user on public.user_choice_events(user_id);
create index if not exists idx_user_choice_events_type on public.user_choice_events(event_type);
create index if not exists idx_user_choice_events_node on public.user_choice_events(node_id);
create index if not exists idx_user_choice_events_created on public.user_choice_events(created_at desc);

create table if not exists public.reflection_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  top_nodes jsonb not null default '[]'::jsonb,
  top_edges jsonb not null default '[]'::jsonb,
  dominant_patterns jsonb not null default '[]'::jsonb,
  tension_pairs jsonb not null default '[]'::jsonb,
  maat_score numeric,
  isfet_risk_score numeric,
  last_computed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.reflection_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('daily','decan','monthly','manual')),
  period_key text not null,
  anchor_nodes jsonb not null default '[]'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  generated_text text not null,
  model_version text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_reflection_generations_user on public.reflection_generations(user_id);
create index if not exists idx_reflection_generations_period on public.reflection_generations(period_type, period_key);
create index if not exists idx_reflection_generations_created on public.reflection_generations(created_at desc);

create table if not exists public.reflection_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reflection_generation_id uuid not null references public.reflection_generations(id) on delete cascade,
  rating integer,
  feedback_tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint uq_reflection_feedback unique (user_id, reflection_generation_id)
);

create index if not exists idx_reflection_feedback_gen on public.reflection_feedback(reflection_generation_id);

-- RLS
alter table public.node_user_content enable row level security;
alter table public.insight_links enable row level security;
alter table public.user_choice_events enable row level security;
alter table public.reflection_profiles enable row level security;
alter table public.reflection_generations enable row level security;
alter table public.reflection_feedback enable row level security;

drop policy if exists "node_user_content owner" on public.node_user_content;
create policy "node_user_content owner" on public.node_user_content
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "insight_links owner" on public.insight_links;
create policy "insight_links owner" on public.insight_links
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_choice_events owner" on public.user_choice_events;
create policy "user_choice_events owner" on public.user_choice_events
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reflection_profiles owner" on public.reflection_profiles;
create policy "reflection_profiles owner" on public.reflection_profiles
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reflection_generations owner" on public.reflection_generations;
create policy "reflection_generations owner" on public.reflection_generations
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reflection_feedback owner" on public.reflection_feedback;
create policy "reflection_feedback owner" on public.reflection_feedback
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Public read access to canonical nodes and node_links
alter table public.nodes enable row level security;
alter table public.node_links enable row level security;
drop policy if exists "nodes readable" on public.nodes;
create policy "nodes readable" on public.nodes for select using (true);
drop policy if exists "node_links readable" on public.node_links;
create policy "node_links readable" on public.node_links for select using (true);

-- system-owned nodes locked from user mutation
drop policy if exists "nodes no user writes" on public.nodes;
create policy "nodes no user writes" on public.nodes for all using (false) with check (false);
drop policy if exists "node_links no user writes" on public.node_links;
create policy "node_links no user writes" on public.node_links for all using (false) with check (false);

-- Trigger helpers
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_node_user_content on public.node_user_content;
create trigger trg_touch_node_user_content before update on public.node_user_content
  for each row execute procedure public.touch_updated_at();
drop trigger if exists trg_touch_insight_links on public.insight_links;
create trigger trg_touch_insight_links before update on public.insight_links
  for each row execute procedure public.touch_updated_at();
drop trigger if exists trg_touch_reflection_profiles on public.reflection_profiles;
create trigger trg_touch_reflection_profiles before update on public.reflection_profiles
  for each row execute procedure public.touch_updated_at();
drop trigger if exists trg_touch_reflection_generations on public.reflection_generations;
create trigger trg_touch_reflection_generations before update on public.reflection_generations
  for each row execute procedure public.touch_updated_at();
drop trigger if exists trg_touch_reflection_feedback on public.reflection_feedback;
create trigger trg_touch_reflection_feedback before update on public.reflection_feedback
  for each row execute procedure public.touch_updated_at();
