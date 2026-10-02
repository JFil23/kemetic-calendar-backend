-- One owner for external projections. No capability writes to external calendars.
create table if not exists public.calendar_import_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null check (source_key = 'google' or source_key like 'device:%'),
  generation uuid not null default gen_random_uuid(),
  refresh_id uuid,
  enabled boolean not null default false,
  connected boolean not null default false,
  pending_initial_import boolean not null default false,
  credentials text,
  last_import_at timestamptz,
  unique(user_id, source_key)
);
alter table public.calendar_import_connections add column if not exists pending_initial_import boolean not null default false;
alter table public.calendar_import_connections enable row level security;
revoke all on public.calendar_import_connections from public, anon, authenticated;
grant all on public.calendar_import_connections to service_role;

create table if not exists public.calendar_import_oauth_states (
  state_hash text primary key,
  connection_id uuid not null references public.calendar_import_connections(id) on delete cascade,
  generation uuid not null,
  return_origin text not null,
  expires_at timestamptz not null
);
create index if not exists calendar_import_oauth_connection_idx on public.calendar_import_oauth_states(connection_id);
alter table public.calendar_import_oauth_states enable row level security;
revoke all on public.calendar_import_oauth_states from public, anon, authenticated;
grant all on public.calendar_import_oauth_states to service_role;

-- Deliberate privileged boundary: credentials never leave server-owned tables.
-- Every operation checks auth.uid(); all identifiers are generated here.
create or replace function private.calendar_import_control(p_source_key text, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.calendar_import_connections;
  legacy_prefix text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_source_key <> 'google' and (p_source_key not like 'device:%' or length(p_source_key) > 180) then
    raise exception 'INVALID_SOURCE';
  end if;
  if p_action not in ('status','connect_device','begin','pause','resume','disconnect') then
    raise exception 'INVALID_ACTION';
  end if;
  insert into public.calendar_import_connections(user_id,source_key)
    values(uid,p_source_key) on conflict(user_id,source_key) do nothing;
  select * into c from public.calendar_import_connections
    where user_id=uid and source_key=p_source_key for update;
  legacy_prefix := case when c.source_key='google' then 'native:google-web:'
    when starts_with(c.source_key,'device:ios:') then 'native:ios:'
    when starts_with(c.source_key,'device:android:') then 'native:android:' else null end;
  if p_action = 'connect_device' then
    if p_source_key = 'google' then raise exception 'OAUTH_REQUIRED'; end if;
    update public.calendar_import_connections set connected=true, generation=gen_random_uuid()
      where id=c.id returning * into c;
  elsif p_action = 'begin' then
    if not c.connected then raise exception 'CONNECTION_REQUIRED'; end if;
    update public.calendar_import_connections set refresh_id=gen_random_uuid()
      where id=c.id returning * into c;
  elsif p_action in ('pause','resume') then
    if not c.connected then raise exception 'CONNECTION_REQUIRED'; end if;
    update public.calendar_import_connections set enabled=p_action='resume',
      generation=gen_random_uuid(), refresh_id=null, pending_initial_import=false where id=c.id returning * into c;
  elsif p_action = 'disconnect' then
    update public.calendar_import_connections set enabled=false, connected=false,
      generation=gen_random_uuid(), refresh_id=null, credentials=null, last_import_at=null, pending_initial_import=false
      where id=c.id returning * into c;
    perform set_config('app.calendar_import_connection',c.id::text,true);
    perform set_config('app.event_delete_suppresses_client','false',true);
    perform set_config('app.event_delete_semantic','calendar_import_disconnect',true);
    delete from public.user_events where user_id=uid
      and starts_with(client_event_id,'native:v2:' || c.id::text || ':');
    legacy_prefix := case when c.source_key='google' then 'native:google-web:'
      when starts_with(c.source_key,'device:ios:') then 'native:ios:'
      when starts_with(c.source_key,'device:android:') then 'native:android:' else null end;
    delete from public.user_events where user_id=uid and
      (starts_with(client_event_id,legacy_prefix) or
       (starts_with(c.source_key,'device:') and category='native_sync' and not starts_with(coalesce(client_event_id,''),'native:')));
    delete from public.calendar_import_oauth_states where connection_id=c.id;
  end if;
  return jsonb_build_object('id',c.id,'generation',c.generation,'refresh_id',c.refresh_id,
    'connected',c.connected,'enabled',c.enabled,'last_import_at',c.last_import_at,
    'pending_initial_import',c.pending_initial_import,
    'has_imports',exists(select 1 from public.user_events where user_id=uid and
      (starts_with(client_event_id,'native:v2:' || c.id::text || ':') or starts_with(client_event_id,legacy_prefix) or
      (starts_with(c.source_key,'device:') and category='native_sync' and not starts_with(coalesce(client_event_id,''),'native:')))));
end $$;
revoke all on function private.calendar_import_control(text,text) from public, anon;
grant execute on function private.calendar_import_control(text,text) to authenticated;

-- Complete-window replacement is atomic. Failed/partial provider reads never call
-- this function. A later refresh, pause or unlink invalidates an older response.
create or replace function private.calendar_import_apply(
  p_connection_id uuid, p_generation uuid, p_refresh_id uuid,
  p_start timestamptz, p_end timestamptz, p_events jsonb, p_time_zone text default 'UTC'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.calendar_import_connections;
  prefix text;
  changed integer := 0;
  removed integer := 0;
  calendar uuid;
  legacy_prefix text;
  migrated integer := 0;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into c from public.calendar_import_connections where id=p_connection_id and user_id=uid for update;
  if c.id is null or not c.connected or c.generation<>p_generation
    or c.refresh_id is distinct from p_refresh_id or p_refresh_id is null then
    raise exception 'STALE_IMPORT';
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end-p_start > interval '2 years'
    or p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events)>20000 then
    raise exception 'INVALID_SNAPSHOT';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_time_zone) then
    raise exception 'INVALID_TIME_ZONE';
  end if;
  -- Provider date-only events are local dates, not UTC instants.
  select coalesce(jsonb_agg(case when e ? 'start_date' then e || jsonb_build_object(
    'start', (e->>'start_date')::date::timestamp at time zone p_time_zone,
    'end', (e->>'end_date')::date::timestamp at time zone p_time_zone) else e end),'[]'::jsonb)
    into p_events from jsonb_array_elements(p_events) e;
  if exists(select 1 from jsonb_array_elements(p_events) e where
    nullif(e->>'key','') is null or length(e->>'key')>1024 or
    e->>'title' is null or (e->>'start')::timestamptz is null or
    (e->>'end')::timestamptz < (e->>'start')::timestamptz) then
    raise exception 'INVALID_EVENT';
  end if;
  if (select count(*)<>count(distinct e->>'key') from jsonb_array_elements(p_events) e) then
    raise exception 'DUPLICATE_OCCURRENCE';
  end if;
  select coalesce(jsonb_agg(e),'[]'::jsonb) into p_events
    from jsonb_array_elements(p_events) e where (e->>'start')::timestamptz < p_end
      and coalesce((e->>'end')::timestamptz,(e->>'start')::timestamptz)>=p_start;
  prefix := 'native:v2:' || c.id::text || ':';
  perform set_config('app.calendar_import_connection',c.id::text,true);
  calendar := public.ensure_personal_calendar_for_user(uid);
  -- Lift only suppressions for this account and these exact imported occurrences.
  update public.event_deletion_trash set suppresses_client=false
    where user_id=uid and suppresses_client and client_event_id in
      (select prefix || (e->>'key') from jsonb_array_elements(p_events) e);
  insert into public.user_events(user_id,client_event_id,title,detail,location,all_day,starts_at,ends_at,category,calendar_id)
    select uid,prefix || (e->>'key'), e->>'title', e->>'detail', e->>'location',
      coalesce((e->>'all_day')::boolean,false),(e->>'start')::timestamptz,(e->>'end')::timestamptz,'native_sync',calendar
    from jsonb_array_elements(p_events) e
    on conflict(client_event_id) do update set title=excluded.title,detail=excluded.detail,
      location=excluded.location,all_day=excluded.all_day,starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,category=excluded.category
    where public.user_events.user_id=uid and
      (public.user_events.title,public.user_events.detail,public.user_events.location,
       public.user_events.all_day,public.user_events.starts_at,public.user_events.ends_at,public.user_events.category)
      is distinct from (excluded.title,excluded.detail,excluded.location,excluded.all_day,
       excluded.starts_at,excluded.ends_at,excluded.category);
  get diagnostics changed = row_count;
  perform set_config('app.event_delete_suppresses_client','false',true);
  perform set_config('app.event_delete_semantic','calendar_import_reconcile',true);
  delete from public.user_events u where u.user_id=uid and starts_with(u.client_event_id,prefix)
    and u.starts_at < p_end and coalesce(u.ends_at,u.starts_at)>=p_start
    and not exists(select 1 from jsonb_array_elements(p_events) e where prefix || (e->>'key')=u.client_event_id);
  get diagnostics removed = row_count;
  -- Retire old-client projections only after a complete replacement for this
  -- same provider and interval succeeds. Other connections and HAw rows stay.
  legacy_prefix := case when c.source_key='google' then 'native:google-web:'
    when starts_with(c.source_key,'device:ios:') then 'native:ios:'
    when starts_with(c.source_key,'device:android:') then 'native:android:' else null end;
  if legacy_prefix is not null then
    delete from public.user_events u where u.user_id=uid and starts_with(u.client_event_id,legacy_prefix)
      and u.starts_at < p_end and coalesce(u.ends_at,u.starts_at)>=p_start;
    get diagnostics migrated = row_count;
  end if;
  update public.calendar_import_connections set last_import_at=now(),refresh_id=null,pending_initial_import=false where id=c.id;
  return jsonb_build_object('changed',changed+removed+migrated,'last_import_at',now());
end $$;
revoke all on function private.calendar_import_apply(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,text) from public, anon;
grant execute on function private.calendar_import_apply(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,text) to authenticated;

create or replace function public.calendar_import_control(p_source_key text,p_action text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.calendar_import_control(p_source_key,p_action)
$$;
revoke all on function public.calendar_import_control(text,text) from public,anon;
grant execute on function public.calendar_import_control(text,text) to authenticated;
grant usage on schema private to authenticated;
create or replace function public.calendar_import_apply(p_connection_id uuid,p_generation uuid,p_refresh_id uuid,
  p_start timestamptz,p_end timestamptz,p_events jsonb,p_time_zone text default 'UTC')
returns jsonb language sql security invoker set search_path = '' as $$
  select private.calendar_import_apply(p_connection_id,p_generation,p_refresh_id,p_start,p_end,p_events,p_time_zone)
$$;
revoke all on function public.calendar_import_apply(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,text) from public,anon;
grant execute on function public.calendar_import_apply(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,text) to authenticated;

-- Older clients and alternate HAw editors cannot mutate imported projections.
-- Account/service cleanup remains possible; ordinary authored rows are untouched.
create or replace function private.guard_calendar_import_projection()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if starts_with(old.client_event_id,'native:v2:') and auth.uid() is not null
    and exists(select 1 from auth.users where id=old.user_id)
    and coalesce(current_setting('app.calendar_import_connection',true),'') <> split_part(old.client_event_id,':',3) then
    raise exception 'IMPORTED_CALENDAR_EVENT_READ_ONLY';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.guard_calendar_import_projection() from public,anon,authenticated;
drop trigger if exists calendar_import_read_only on public.user_events;
create trigger calendar_import_read_only before update or delete on public.user_events
  for each row execute function private.guard_calendar_import_projection();
