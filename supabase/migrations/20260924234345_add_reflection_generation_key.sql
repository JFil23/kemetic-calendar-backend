-- pg-delta: transaction=false

set lock_timeout = '3s';
set statement_timeout = '30s';

alter table public.reflection_generations
  add column generation_key text;

reset lock_timeout;
set statement_timeout = '5min';

create unique index concurrently reflection_generations_generation_key_uidx
  on public.reflection_generations using btree (generation_key)
  where generation_key is not null;

reset statement_timeout;
