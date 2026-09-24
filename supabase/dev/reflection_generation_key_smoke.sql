-- Local-only Cut 6 smoke test. Run after migrations against a disposable DB.
-- The transaction rolls back every fixture row.

begin;

create or replace function pg_temp.assert_true(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception '%', p_message;
  end if;
end;
$$;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-00000000c601',
  'authenticated',
  'authenticated',
  'reflection-generation-key-cut6@example.test',
  'not-used',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

-- Existing writers omit generation_key. Multiple legacy NULLs must remain legal.
insert into public.reflection_generations (
  user_id,
  period_type,
  period_key,
  generated_text
) values
  (
    '00000000-0000-4000-8000-00000000c601',
    'manual',
    'cut6-legacy-null-a',
    'Cut 6 legacy NULL A'
  ),
  (
    '00000000-0000-4000-8000-00000000c601',
    'manual',
    'cut6-legacy-null-b',
    'Cut 6 legacy NULL B'
  );

select pg_temp.assert_true(
  count(*) = 2 and bool_and(generation_key is null),
  'pre-Cut-6 inserts must still succeed and retain NULL generation_key'
)
from public.reflection_generations
where user_id = '00000000-0000-4000-8000-00000000c601'
  and period_key like 'cut6-legacy-null-%';

insert into public.reflection_generations (
  user_id,
  period_type,
  period_key,
  generated_text,
  generation_key
) values
  (
    '00000000-0000-4000-8000-00000000c601',
    'manual',
    'cut6-key-a',
    'Cut 6 explicit key A',
    'test-key-a'
  ),
  (
    '00000000-0000-4000-8000-00000000c601',
    'manual',
    'cut6-key-b',
    'Cut 6 explicit key B',
    'test-key-b'
  );

do $$
begin
  begin
    insert into public.reflection_generations (
      user_id,
      period_type,
      period_key,
      generated_text,
      generation_key
    ) values (
      '00000000-0000-4000-8000-00000000c601',
      'manual',
      'cut6-key-a-duplicate',
      'Cut 6 duplicate explicit key A',
      'test-key-a'
    );

    raise exception 'duplicate non-NULL generation_key unexpectedly accepted';
  exception
    when unique_violation then
      null;
  end;
end;
$$;

select pg_temp.assert_true(
  count(*) = 4
    and count(*) filter (where generation_key is null) = 2
    and count(*) filter (where generation_key = 'test-key-a') = 1
    and count(*) filter (where generation_key = 'test-key-b') = 1,
  'NULL keys must remain unlimited while distinct explicit keys remain legal'
)
from public.reflection_generations
where user_id = '00000000-0000-4000-8000-00000000c601';

-- Exercise the exact pre-Cut-6 reader projection.
select pg_temp.assert_true(
  count(*) = 4
    and bool_and(id is not null)
    and bool_and(user_id = '00000000-0000-4000-8000-00000000c601')
    and bool_and(period_type = 'manual')
    and bool_and(anchor_nodes = '[]'::jsonb)
    and bool_and(source_snapshot = '{}'::jsonb)
    and bool_and(generated_text is not null)
    and bool_and(metadata = '{}'::jsonb)
    and bool_and(created_at is not null),
  'pre-Cut-6 reflection_generations reader projection must remain unchanged'
)
from (
  select
    id,
    user_id,
    period_type,
    period_key,
    anchor_nodes,
    source_snapshot,
    generated_text,
    model_version,
    metadata,
    created_at
  from public.reflection_generations
  where user_id = '00000000-0000-4000-8000-00000000c601'
) legacy_reader;

select pg_temp.assert_true(
  data_type = 'text'
    and is_nullable = 'YES'
    and column_default is null,
  'generation_key must be nullable text with no default'
)
from information_schema.columns
where table_schema = 'public'
  and table_name = 'reflection_generations'
  and column_name = 'generation_key';

select pg_temp.assert_true(
  count(*) = 1
    and bool_and(i.indisunique and i.indisvalid and i.indisready and i.indislive)
    and bool_and(pg_get_expr(i.indpred, i.indrelid) = '(generation_key IS NOT NULL)'),
  'generation_key unique partial index must be valid, ready, live, and non-NULL only'
)
from pg_index i
join pg_class index_relation on index_relation.oid = i.indexrelid
join pg_class table_relation on table_relation.oid = i.indrelid
join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
where table_namespace.nspname = 'public'
  and table_relation.relname = 'reflection_generations'
  and index_relation.relname = 'reflection_generations_generation_key_uidx';

select pg_temp.assert_true(
  count(*) = 2
    and count(*) filter (
      where conname = 'maat_guidance_deliveries_generation_id_fkey'
        and conrelid = 'public.maat_guidance_deliveries'::regclass
        and convalidated
    ) = 1
    and count(*) filter (
      where conname = 'reflection_feedback_reflection_generation_id_fkey'
        and conrelid = 'public.reflection_feedback'::regclass
        and convalidated
    ) = 1,
  'all foreign keys into reflection_generations must remain unchanged'
)
from pg_constraint
where contype = 'f'
  and confrelid = 'public.reflection_generations'::regclass;

select pg_temp.assert_true(
  table_relation.relrowsecurity
    and not table_relation.relforcerowsecurity
    and (
      select count(*) = 1
      from pg_policy policy
      where policy.polrelid = table_relation.oid
        and policy.polname = 'reflection_generations owner'
    ),
  'reflection_generations RLS and owner policy must remain unchanged'
)
from pg_class table_relation
join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
where table_namespace.nspname = 'public'
  and table_relation.relname = 'reflection_generations';

rollback;
