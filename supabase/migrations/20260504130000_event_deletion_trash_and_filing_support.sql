create table if not exists public.event_deletion_trash (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_table text not null default 'user_events',
  source_id uuid,
  client_event_id text,
  calendar_id uuid references public.shared_calendars(id) on delete set null,
  flow_local_id bigint,
  title text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  deleted_at timestamp with time zone not null default timezone('utc', now()),
  purge_after timestamp with time zone not null default timezone('utc', now()) + interval '10 days',
  purged_at timestamp with time zone,
  row_data jsonb not null default '{}'::jsonb
);

alter table public.event_deletion_trash
  add column if not exists source_table text not null default 'user_events',
  add column if not exists source_id uuid,
  add column if not exists client_event_id text,
  add column if not exists calendar_id uuid references public.shared_calendars(id) on delete set null,
  add column if not exists flow_local_id bigint,
  add column if not exists title text,
  add column if not exists starts_at timestamp with time zone,
  add column if not exists ends_at timestamp with time zone,
  add column if not exists deleted_at timestamp with time zone not null default timezone('utc', now()),
  add column if not exists purge_after timestamp with time zone not null default timezone('utc', now()) + interval '10 days',
  add column if not exists purged_at timestamp with time zone,
  add column if not exists row_data jsonb not null default '{}'::jsonb;

create index if not exists event_deletion_trash_user_client_idx
  on public.event_deletion_trash (user_id, client_event_id)
  where client_event_id is not null and purged_at is null;

create index if not exists event_deletion_trash_purge_idx
  on public.event_deletion_trash (purge_after)
  where purged_at is null;

alter table public.event_deletion_trash enable row level security;

revoke all on public.event_deletion_trash from anon;
revoke all on public.event_deletion_trash from authenticated;
grant all on public.event_deletion_trash to service_role;

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
  row_data
)
select
  ue.user_id,
  'user_events_tombstone',
  ue.id,
  ue.client_event_id,
  ue.calendar_id,
  ue.flow_local_id,
  ue.title,
  ue.starts_at,
  ue.ends_at,
  coalesce(ue.updated_at, ue.created_at, timezone('utc', now())),
  coalesce(ue.updated_at, ue.created_at, timezone('utc', now())) + interval '10 days',
  to_jsonb(ue)
from public.user_events ue
where lower(coalesce(ue.category, '')) = 'tombstone'
  and not exists (
    select 1
    from public.event_deletion_trash edt
    where edt.user_id = ue.user_id
      and edt.source_id = ue.id
      and edt.source_table = 'user_events_tombstone'
  );

delete from public.user_events ue
where lower(coalesce(ue.category, '')) = 'tombstone';

create or replace function public.archive_deleted_user_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    to_jsonb(old)
  );

  return old;
end;
$$;

drop trigger if exists trg_archive_deleted_user_event on public.user_events;
create trigger trg_archive_deleted_user_event
before delete on public.user_events
for each row
execute function public.archive_deleted_user_event();

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
    jsonb_build_object(
      'reason', coalesce(nullif(btrim(p_reason), ''), 'client_delete')
    )
  );
end;
$$;

revoke all on function public.record_user_event_tombstone(text, uuid, text) from public;
grant execute on function public.record_user_event_tombstone(text, uuid, text) to authenticated;

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
  select nullif(btrim(coalesce(p_client_event_id, '')), '') is not null
    and exists (
      select 1
      from public.event_deletion_trash edt
      where edt.user_id = p_user_id
        and edt.client_event_id = btrim(p_client_event_id)
        and edt.purged_at is null
        and edt.purge_after > timezone('utc', now())
    )
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
  with deleted as (
    delete from public.event_deletion_trash edt
    where edt.purge_after <= timezone('utc', now())
    returning 1
  )
  select count(*)::integer into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.purge_old_event_deletion_trash() from public;
grant execute on function public.purge_old_event_deletion_trash() to service_role;

create or replace function public.enforce_user_event_flow_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client_flow_id bigint;
  v_detail_flow_id bigint;
  v_action_flow_id bigint;
  v_flow_active boolean;
  v_flow_is_hidden boolean;
  v_flow_notes text;
begin
  if new.flow_local_id is not null and new.flow_local_id <= 0 then
    new.flow_local_id := null;
  end if;

  if lower(coalesce(new.category, '')) = 'tombstone' then
    perform public.record_user_event_tombstone(
      new.client_event_id,
      new.calendar_id,
      'user_events_tombstone'
    );
    return null;
  end if;

  if public.user_event_recently_deleted(new.user_id, new.client_event_id) then
    raise exception 'EVENT_RECENTLY_DELETED';
  end if;

  v_client_flow_id := public.flow_id_from_client_event_id(new.client_event_id);
  v_detail_flow_id := public.flow_id_from_detail_metadata(new.detail);
  v_action_flow_id := public.flow_id_from_action_id(new.user_id, new.action_id);

  new.flow_local_id := coalesce(
    v_client_flow_id,
    v_detail_flow_id,
    v_action_flow_id,
    new.flow_local_id
  );

  if new.flow_local_id is null then
    return new;
  end if;

  select f.active, f.is_hidden, f.notes
    into v_flow_active, v_flow_is_hidden, v_flow_notes
  from public.flows f
  where f.id = new.flow_local_id
  limit 1;

  if not found then
    raise exception 'FLOW_NOT_FOUND';
  end if;

  if public.flow_is_deleted_state(
    v_flow_active,
    v_flow_is_hidden,
    v_flow_notes
  ) then
    raise exception 'FLOW_ALREADY_DELETED';
  end if;

  return new;
end;
$$;

comment on function public.enforce_user_event_flow_integrity() is
'Canonical user_events guard. Moves tombstones out of client-readable event rows, blocks recently deleted client ids during the 10-day trash retention window, normalizes embedded flow metadata and generated action ids into flow_local_id, and blocks linking events to deleted flows.';

drop trigger if exists trg_enforce_user_event_flow_integrity on public.user_events;
create trigger trg_enforce_user_event_flow_integrity
before insert or update of flow_local_id, client_event_id, detail, category, action_id
on public.user_events
for each row
execute function public.enforce_user_event_flow_integrity();

notify pgrst, 'reload schema';
