-- Cut 6 rollback only. Prefer leaving the unused nullable schema in place.
-- Apply only if rollback is necessary, and drop the index before the column.
-- pg-delta: transaction=false

drop index concurrently if exists
  public.reflection_generations_generation_key_uidx;

alter table public.reflection_generations
  drop column if exists generation_key;
