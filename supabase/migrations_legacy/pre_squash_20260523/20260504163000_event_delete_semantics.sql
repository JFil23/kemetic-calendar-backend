alter table public.event_deletion_trash
  add column if not exists delete_semantic text not null default 'user_delete',
  add column if not exists suppresses_client boolean not null default true,
  add column if not exists source_feature text,
  add column if not exists delete_scope text not null default 'exact_occurrence',
  add column if not exists operation_id uuid not null default gen_random_uuid(),
  add column if not exists actor_id uuid references auth.users(id) on delete set null;

create index if not exists event_deletion_trash_suppressing_client_idx
  on public.event_deletion_trash (user_id, client_event_id)
  where client_event_id is not null
    and purged_at is null
    and suppresses_client = true;

create index if not exists event_deletion_trash_operation_idx
  on public.event_deletion_trash (operation_id);

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
    true
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

create or replace function public.record_user_event_tombstone(
  p_client_event_id text,
  p_calendar_id uuid default null,
  p_reason text default 'client_delete'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_client_event_id text := nullif(btrim(p_client_event_id), '');
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'client_delete');
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_client_event_id is null then
    return;
  end if;

  if p_calendar_id is not null and not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_uid
      and scm.status = 'accepted'
      and sc.deleted_at is null
  ) then
    raise exception 'CALENDAR_NOT_ACCESSIBLE';
  end if;

  insert into public.event_deletion_trash (
    user_id,
    source_table,
    client_event_id,
    calendar_id,
    title,
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
    v_uid,
    'client_tombstone',
    v_client_event_id,
    p_calendar_id,
    'deleted',
    timezone('utc', now()),
    timezone('utc', now()) + interval '10 days',
    'client_tombstone',
    true,
    'record_user_event_tombstone',
    case
      when v_client_event_id like 'reminder:rule:%' then 'reminder_rule'
      when v_client_event_id like 'reminder:%' and v_client_event_id not like 'reminder:%:%' then 'reminder_series'
      else 'exact_occurrence'
    end,
    v_operation_id,
    v_uid,
    jsonb_build_object(
      'reason', v_reason,
      'delete_semantic', 'client_tombstone',
      'suppresses_client', true,
      'source_feature', 'record_user_event_tombstone',
      'operation_id', v_operation_id,
      'actor_id', v_uid
    )
  );
end;
$$;

create or replace function public.delete_user_events_by_ids_semantic(
  p_ids text[],
  p_delete_semantic text default 'user_delete',
  p_suppresses_client boolean default true,
  p_source_feature text default null,
  p_delete_scope text default 'exact_occurrence'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_ids_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'exact_occurrence'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with input_ids as (
    select distinct nullif(btrim(raw_id), '')::uuid as id
    from unnest(p_ids) as raw_id
    where nullif(btrim(raw_id), '') is not null
  ),
  deleted as (
    delete from public.user_events ue
    using input_ids
    where ue.user_id = v_uid
      and ue.id = input_ids.id
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.delete_user_events_by_client_id_semantic(
  p_client_event_id text,
  p_delete_semantic text default 'user_delete',
  p_suppresses_client boolean default true,
  p_source_feature text default null,
  p_delete_scope text default 'exact_occurrence'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_client_event_id text := nullif(btrim(p_client_event_id), '');
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_client_event_id is null then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_client_id_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'exact_occurrence'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and ue.client_event_id = v_client_event_id
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.delete_user_events_by_client_id_prefix_semantic(
  p_client_event_id_prefix text,
  p_from_utc timestamp with time zone default null,
  p_until_utc timestamp with time zone default null,
  p_delete_semantic text default 'user_delete',
  p_suppresses_client boolean default true,
  p_source_feature text default null,
  p_delete_scope text default 'client_id_prefix'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text := nullif(btrim(p_client_event_id_prefix), '');
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_prefix is null then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_client_id_prefix_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'client_id_prefix'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and left(coalesce(ue.client_event_id, ''), char_length(v_prefix)) = v_prefix
      and (p_from_utc is null or ue.starts_at >= p_from_utc)
      and (p_until_utc is null or ue.starts_at < p_until_utc)
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.delete_user_events_by_flow_semantic(
  p_flow_id bigint,
  p_from_utc timestamp with time zone default null,
  p_until_utc timestamp with time zone default null,
  p_delete_semantic text default 'user_delete',
  p_suppresses_client boolean default true,
  p_source_feature text default null,
  p_delete_scope text default 'flow'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_flow_id is null or p_flow_id <= 0 then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_flow_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'flow'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and ue.flow_local_id = p_flow_id
      and (p_from_utc is null or ue.starts_at >= p_from_utc)
      and (p_until_utc is null or ue.starts_at < p_until_utc)
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.delete_user_events_by_category_semantic(
  p_category text,
  p_delete_semantic text default 'user_delete',
  p_suppresses_client boolean default true,
  p_source_feature text default null,
  p_delete_scope text default 'category'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_category text := nullif(btrim(p_category), '');
  v_count integer := 0;
  v_operation_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_category is null then
    return 0;
  end if;

  perform set_config(
    'app.event_delete_semantic',
    coalesce(nullif(btrim(p_delete_semantic), ''), 'user_delete'),
    true
  );
  perform set_config(
    'app.event_delete_suppresses_client',
    coalesce(p_suppresses_client, true)::text,
    true
  );
  perform set_config(
    'app.event_delete_source_feature',
    coalesce(nullif(btrim(p_source_feature), ''), 'delete_user_events_by_category_semantic'),
    true
  );
  perform set_config(
    'app.event_delete_scope',
    coalesce(nullif(btrim(p_delete_scope), ''), 'category'),
    true
  );
  perform set_config('app.event_delete_operation_id', v_operation_id::text, true);

  with deleted as (
    delete from public.user_events ue
    where ue.user_id = v_uid
      and ue.category = v_category
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.delete_user_events_by_ids_semantic(
  text[],
  text,
  boolean,
  text,
  text
) from public;
revoke all on function public.delete_user_events_by_client_id_semantic(
  text,
  text,
  boolean,
  text,
  text
) from public;
revoke all on function public.delete_user_events_by_client_id_prefix_semantic(
  text,
  timestamp with time zone,
  timestamp with time zone,
  text,
  boolean,
  text,
  text
) from public;
revoke all on function public.delete_user_events_by_flow_semantic(
  bigint,
  timestamp with time zone,
  timestamp with time zone,
  text,
  boolean,
  text,
  text
) from public;
revoke all on function public.delete_user_events_by_category_semantic(
  text,
  text,
  boolean,
  text,
  text
) from public;

grant execute on function public.delete_user_events_by_ids_semantic(
  text[],
  text,
  boolean,
  text,
  text
) to authenticated;
grant execute on function public.delete_user_events_by_client_id_semantic(
  text,
  text,
  boolean,
  text,
  text
) to authenticated;
grant execute on function public.delete_user_events_by_client_id_prefix_semantic(
  text,
  timestamp with time zone,
  timestamp with time zone,
  text,
  boolean,
  text,
  text
) to authenticated;
grant execute on function public.delete_user_events_by_flow_semantic(
  bigint,
  timestamp with time zone,
  timestamp with time zone,
  text,
  boolean,
  text,
  text
) to authenticated;
grant execute on function public.delete_user_events_by_category_semantic(
  text,
  text,
  boolean,
  text,
  text
) to authenticated;

create or replace function public.user_event_recently_deleted(
  p_user_id uuid,
  p_client_event_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with input as (
    select
      nullif(btrim(coalesce(p_client_event_id, '')), '') as client_event_id,
      public.user_event_reminder_uuid(p_client_event_id) as reminder_uuid
  ),
  tombstone_keys as (
    select
      input.client_event_id,
      input.reminder_uuid,
      case
        when input.reminder_uuid is null then null
        else 'reminder:' || input.reminder_uuid::text
      end as reminder_series_key,
      case
        when input.reminder_uuid is null then null
        else 'reminder:rule:' || input.reminder_uuid::text
      end as reminder_rule_key
    from input
  ),
  filing_state as (
    select
      tombstone_keys.client_event_id,
      tombstone_keys.reminder_uuid,
      exists (
        select 1
        from public.event_deletion_trash edt
        where edt.user_id = p_user_id
          and edt.purged_at is null
          and edt.purge_after > timezone('utc', now())
          and edt.suppresses_client = true
          and edt.client_event_id = tombstone_keys.client_event_id
      ) as has_exact_tombstone,
      exists (
        select 1
        from public.event_deletion_trash edt
        where edt.user_id = p_user_id
          and edt.purged_at is null
          and edt.purge_after > timezone('utc', now())
          and edt.suppresses_client = true
          and tombstone_keys.reminder_uuid is not null
          and edt.client_event_id in (
            tombstone_keys.reminder_series_key,
            tombstone_keys.reminder_rule_key
          )
      ) as has_series_tombstone,
      public.user_event_has_active_reminder_flow_for_occurrence(
        p_user_id,
        tombstone_keys.client_event_id
      ) as has_active_reminder_flow,
      exists (
        select 1
        from public.reminders r
        where r.user_id = p_user_id
          and r.id = tombstone_keys.reminder_uuid
      ) as has_legacy_reminder_row,
      exists (
        select 1
        from public.scheduled_notifications sn
        where sn.user_id = p_user_id
          and sn.is_active = true
          and sn.client_event_id = tombstone_keys.client_event_id
      ) as has_active_notification
    from tombstone_keys
  )
  select filing_state.client_event_id is not null
    and (
      filing_state.has_exact_tombstone
      or filing_state.has_series_tombstone
      or (
        filing_state.reminder_uuid is not null
        and filing_state.has_active_reminder_flow = false
        and filing_state.has_legacy_reminder_row = false
        and filing_state.has_active_notification = false
      )
    )
  from filing_state
$$;

create or replace function public.purge_old_event_deletion_trash()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  delete from public.user_events ue
  using public.event_deletion_trash edt
  where edt.purge_after <= timezone('utc', now())
    and edt.purged_at is null
    and edt.suppresses_client = true
    and edt.user_id = ue.user_id
    and edt.client_event_id is not null
    and ue.client_event_id = edt.client_event_id;

  with deleted as (
    delete from public.event_deletion_trash edt
    where edt.purge_after <= timezone('utc', now())
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

notify pgrst, 'reload schema';
