-- Add glyph column to medu_dictionary
alter table if exists public.medu_dictionary
  add column if not exists glyph text;

-- keep existing unique index on key if present
