begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

create temp table cut18_restoration_contract_before on commit drop as
select
  (
    select md5(coalesce(string_agg(
      md5(row_to_json(row_value)::text),
      '' order by user_id, scope, device_id, window_id
    ), ''))
    from public.user_app_restoration_snapshots row_value
  ) as row_fingerprint,
  (
    select md5(coalesce(string_agg(
      concat_ws(
        '|',
        policyname,
        roles::text,
        cmd,
        coalesce(qual, ''),
        coalesce(with_check, '')
      ),
      E'\n' order by policyname
    ), ''))
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_app_restoration_snapshots'
  ) as policy_fingerprint,
  (
    select md5(coalesce(string_agg(
      concat_ws('|', grantee, privilege_type),
      E'\n' order by grantee, privilege_type
    ), ''))
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'user_app_restoration_snapshots'
  ) as grant_fingerprint;

do $$
begin
  if to_regprocedure(
    'private.prevent_stale_restoration_snapshot_update()'
  ) is null then
    raise exception 'stale restoration guard function is missing';
  end if;

  if not exists (
    select 1
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname =
        'prevent_stale_restoration_snapshot_update'
      and not function.prosecdef
      and function.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'stale restoration guard is not hardened invoker code';
  end if;

  if has_function_privilege(
    'anon',
    'private.prevent_stale_restoration_snapshot_update()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'private.prevent_stale_restoration_snapshot_update()',
    'execute'
  ) then
    raise exception 'stale restoration trigger function is client-callable';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid =
        'public.user_app_restoration_snapshots'::regclass
      and trigger.tgname =
        'user_app_restoration_prevent_stale_update'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and pg_get_triggerdef(trigger.oid, true) =
        'CREATE TRIGGER user_app_restoration_prevent_stale_update ' ||
        'BEFORE UPDATE ON user_app_restoration_snapshots FOR EACH ROW ' ||
        'EXECUTE FUNCTION ' ||
        'private.prevent_stale_restoration_snapshot_update()'
  ) then
    raise exception 'stale restoration trigger identity changed';
  end if;
end
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
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'authenticated',
    'authenticated',
    'cut18-owner@example.test',
    'not-used',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001802',
    'authenticated',
    'authenticated',
    'cut18-other@example.test',
    'not-used',
    now(),
    now(),
    now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001801",'
    || '"role":"authenticated"}',
  true
);

-- The same two-row shape used by AppRestorationRepo.upsertSnapshots().
insert into public.user_app_restoration_snapshots (
  user_id,
  scope,
  device_id,
  window_id,
  snapshot,
  schema_version,
  route_location,
  updated_at
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'window',
    'cut18-device-a',
    'cut18-window-a',
    '{"state":"initial-a"}',
    2,
    '/cut18/initial-a',
    '2026-01-18 01:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001801',
    'latest',
    '',
    '',
    '{"state":"initial-a"}',
    2,
    '/cut18/initial-a',
    '2026-01-18 01:00:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;

-- A genuinely newer write replaces both rows.
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'window',
    'cut18-device-a',
    'cut18-window-a',
    '{"state":"newer-a"}',
    2,
    '/cut18/newer-a',
    '2026-01-18 02:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001801',
    'latest',
    '',
    '',
    '{"state":"newer-a"}',
    2,
    '/cut18/newer-a',
    '2026-01-18 02:00:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;

-- An older delayed replay must update neither the window nor latest row.
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'window',
    'cut18-device-a',
    'cut18-window-a',
    '{"state":"stale-a"}',
    2,
    '/cut18/stale-a',
    '2026-01-18 01:30:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001801',
    'latest',
    '',
    '',
    '{"state":"stale-a"}',
    2,
    '/cut18/stale-a',
    '2026-01-18 01:30:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;

-- Replaying the same stale write remains harmless.
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'window',
    'cut18-device-a',
    'cut18-window-a',
    '{"state":"stale-a-replay"}',
    2,
    '/cut18/stale-a-replay',
    '2026-01-18 01:30:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001801',
    'latest',
    '',
    '',
    '{"state":"stale-a-replay"}',
    2,
    '/cut18/stale-a-replay',
    '2026-01-18 01:30:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;

do $$
begin
  if (
    select count(*)
    from public.user_app_restoration_snapshots
    where user_id = '00000000-0000-4000-8000-000000001801'
      and snapshot = '{"state":"newer-a"}'::jsonb
      and updated_at = '2026-01-18 02:00:00+00'
  ) <> 2 then
    raise exception 'stale write replaced window or latest state';
  end if;
end
$$;

-- A stale second-device write creates its absent window row independently,
-- while the conflicting shared latest row remains on the newer state.
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'window',
    'cut18-device-b',
    'cut18-window-b',
    '{"state":"older-b-window"}',
    2,
    '/cut18/older-b-window',
    '2026-01-18 00:30:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001801',
    'latest',
    '',
    '',
    '{"state":"older-b-latest"}',
    2,
    '/cut18/older-b-latest',
    '2026-01-18 00:30:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;

do $$
begin
  if not exists (
    select 1
    from public.user_app_restoration_snapshots
    where user_id = '00000000-0000-4000-8000-000000001801'
      and scope = 'window'
      and device_id = 'cut18-device-b'
      and window_id = 'cut18-window-b'
      and snapshot = '{"state":"older-b-window"}'::jsonb
  ) or not exists (
    select 1
    from public.user_app_restoration_snapshots
    where user_id = '00000000-0000-4000-8000-000000001801'
      and scope = 'latest'
      and snapshot = '{"state":"newer-a"}'::jsonb
  ) then
    raise exception 'cross-device row independence changed';
  end if;
end
$$;

-- A later genuinely newer second-device write may replace both its window
-- and shared latest state.
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'window',
    'cut18-device-b',
    'cut18-window-b',
    '{"state":"newer-b"}',
    2,
    '/cut18/newer-b',
    '2026-01-18 03:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001801',
    'latest',
    '',
    '',
    '{"state":"newer-b"}',
    2,
    '/cut18/newer-b',
    '2026-01-18 03:00:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;

-- Equal timestamps preserve the existing arrival-order behavior.
insert into public.user_app_restoration_snapshots (
  user_id, scope, device_id, window_id, snapshot,
  schema_version, route_location, updated_at
) values
  (
    '00000000-0000-4000-8000-000000001801',
    'window',
    'cut18-device-b',
    'cut18-window-b',
    '{"state":"equal-b"}',
    2,
    '/cut18/equal-b',
    '2026-01-18 03:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001801',
    'latest',
    '',
    '',
    '{"state":"equal-b"}',
    2,
    '/cut18/equal-b',
    '2026-01-18 03:00:00+00'
  )
on conflict (user_id, scope, device_id, window_id)
do update set
  snapshot = excluded.snapshot,
  schema_version = excluded.schema_version,
  route_location = excluded.route_location,
  updated_at = excluded.updated_at;

do $$
begin
  if (
    select count(*)
    from public.user_app_restoration_snapshots
    where user_id = '00000000-0000-4000-8000-000000001801'
      and snapshot = '{"state":"equal-b"}'::jsonb
      and updated_at = '2026-01-18 03:00:00+00'
  ) <> 2 then
    raise exception 'equal/newer restoration upsert behavior changed';
  end if;

  begin
    insert into public.user_app_restoration_snapshots (
      user_id, scope, device_id, window_id, snapshot,
      schema_version, route_location, updated_at
    ) values (
      '00000000-0000-4000-8000-000000001802',
      'window',
      'cut18-forbidden-device',
      'cut18-forbidden-window',
      '{"state":"forbidden"}',
      2,
      '/cut18/forbidden',
      '2026-01-18 04:00:00+00'
    );

    raise exception 'ownership policy allowed another user write';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

reset role;
delete from auth.users
where id in (
  '00000000-0000-4000-8000-000000001801',
  '00000000-0000-4000-8000-000000001802'
);

do $$
declare
  v_row_fingerprint text;
  v_policy_fingerprint text;
  v_grant_fingerprint text;
begin
  select md5(coalesce(string_agg(
    md5(row_to_json(row_value)::text),
    '' order by user_id, scope, device_id, window_id
  ), '')) into v_row_fingerprint
  from public.user_app_restoration_snapshots row_value;

  select md5(coalesce(string_agg(
    concat_ws(
      '|',
      policyname,
      roles::text,
      cmd,
      coalesce(qual, ''),
      coalesce(with_check, '')
    ),
    E'\n' order by policyname
  ), '')) into v_policy_fingerprint
  from pg_policies
  where schemaname = 'public'
    and tablename = 'user_app_restoration_snapshots';

  select md5(coalesce(string_agg(
    concat_ws('|', grantee, privilege_type),
    E'\n' order by grantee, privilege_type
  ), '')) into v_grant_fingerprint
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'user_app_restoration_snapshots';

  if not exists (
    select 1
    from cut18_restoration_contract_before before
    where before.row_fingerprint = v_row_fingerprint
      and before.policy_fingerprint = v_policy_fingerprint
      and before.grant_fingerprint = v_grant_fingerprint
  ) then
    raise exception 'existing rows, RLS policies, or grants changed';
  end if;
end
$$;

rollback;
