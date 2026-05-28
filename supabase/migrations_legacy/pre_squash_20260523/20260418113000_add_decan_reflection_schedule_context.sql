alter table public.decan_reflection_schedule
  add column if not exists decan_name text,
  add column if not exists decan_theme text,
  add column if not exists decan_context_key text;
