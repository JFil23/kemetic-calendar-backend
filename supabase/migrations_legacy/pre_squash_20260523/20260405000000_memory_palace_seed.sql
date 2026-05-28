-- Memory Palace seed schema extension
-- Adds mnemonic-specific metadata columns to medu_dictionary

alter table if exists public.medu_dictionary
  add column if not exists key text,
  add column if not exists primary_gloss text,
  add column if not exists anchor_type text,
  add column if not exists imageability_score integer,
  add column if not exists phonetic_flexibility_score integer,
  add column if not exists mnemonic_aliases text[],
  add column if not exists render_mode text,
  add column if not exists image_asset_key text,
  add column if not exists image_prompt text,
  add column if not exists visual_description text,
  add column if not exists source_confidence text;

create unique index if not exists medu_dictionary_key_uidx on public.medu_dictionary(key) where key is not null;
