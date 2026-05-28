create or replace function public.archive_deleted_user_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_semantic text := coalesce(
    nullif(btrim(current_setting('app.event_delete_semantic', true)), ''),
    'raw_delete'
  );
  v_suppresses_client boolean := coalesce(
    nullif(btrim(current_setting('app.event_delete_suppresses_client', true)), '')::boolean,
    false
  );
  v_source_feature text := nullif(
    btrim(current_setting('app.event_delete_source_feature', true)),
    ''
  );
  v_delete_scope text := coalesce(
    nullif(btrim(current_setting('app.event_delete_scope', true)), ''),
    'exact_occurrence'
  );
  v_operation_id uuid := coalesce(
    nullif(btrim(current_setting('app.event_delete_operation_id', true)), '')::uuid,
    gen_random_uuid()
  );
  v_actor_id uuid := auth.uid();
begin
  insert into public.event_deletion_trash (
    user_id,
    source_table,
    source_id,
    client_event_id,
    calendar_id,
    flow_local_id,
    title,
    starts_at,
    ends_at,
    deleted_at,
    purge_after,
    delete_semantic,
    suppresses_client,
    source_feature,
    delete_scope,
    operation_id,
    actor_id,
    row_data
  )
  values (
    old.user_id,
    'user_events',
    old.id,
    old.client_event_id,
    old.calendar_id,
    old.flow_local_id,
    old.title,
    old.starts_at,
    old.ends_at,
    timezone('utc', now()),
    timezone('utc', now()) + interval '10 days',
    v_semantic,
    v_suppresses_client,
    v_source_feature,
    v_delete_scope,
    v_operation_id,
    v_actor_id,
    to_jsonb(old) || jsonb_build_object(
      'delete_semantic', v_semantic,
      'suppresses_client', v_suppresses_client,
      'source_feature', v_source_feature,
      'delete_scope', v_delete_scope,
      'operation_id', v_operation_id,
      'actor_id', v_actor_id
    )
  );

  return old;
end;
$$;

comment on function public.archive_deleted_user_event() is
'Archives deleted user_events rows. Raw deletes are audit-only by default; durable client suppression must come through semantic delete RPCs or explicit trigger settings.';

notify pgrst, 'reload schema';
