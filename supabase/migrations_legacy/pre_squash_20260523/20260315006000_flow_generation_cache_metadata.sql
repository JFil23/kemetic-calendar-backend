-- Add model metadata to flow_generation_cache so cache hits can report original model
alter table public.flow_generation_cache
  add column if not exists model_used text;

-- Optional but useful for debugging / analytics:
alter table public.flow_generation_cache
  add column if not exists llm_status text;

alter table public.flow_generation_cache
  add column if not exists prompt_fingerprint text;

-- Index: your existing lookup index is already very strong.
-- If you want a tiny boost on "latest cache row" reads, you can add:
-- (Usually not required given your existing composite lookup index)
create index if not exists flow_generation_cache_user_created_at_idx
  on public.flow_generation_cache (user_id, created_at desc);
