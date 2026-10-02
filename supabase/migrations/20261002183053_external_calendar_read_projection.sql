-- External calendars are disposable, read-only projections. They never enter
-- authored calendar storage. Lane is an explicit boundary even on shared backend.
create schema if not exists private;

create table private.external_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lane text not null check (lane in ('staging','production')),
  provider text not null check (provider = 'google'),
  provider_subject text not null,
  account_label text not null,
  credentials jsonb not null,
  status text not null default 'connected' check (status in ('connected','paused','reconnect_required')),
  automatic boolean not null default true,
  generation bigint not null default 1,
  time_zone text not null default 'UTC',
  last_synced_at timestamptz,
  error_code text,
  retry_at timestamptz,
  next_refresh_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique(user_id,lane,provider)
);
create index external_calendar_due_idx on private.external_calendar_connections(next_refresh_at)
  where status='connected' and automatic;

create table private.external_calendar_sources (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.external_calendar_connections(id) on delete cascade,
  provider_calendar_id text not null,
  label text not null,
  color text,
  selected boolean not null default false,
  last_synced_at timestamptz,
  error_code text,
  unique(connection_id,provider_calendar_id)
);
create table private.external_calendar_oauth_requests (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lane text not null check(lane in ('staging','production')),
  envelope jsonb not null,
  expected_connection uuid,
  expected_generation bigint,
  expires_at timestamptz not null default now()+interval '10 minutes'
);
create index external_calendar_oauth_owner_idx on private.external_calendar_oauth_requests(user_id,lane);
create index external_calendar_oauth_expiry_idx on private.external_calendar_oauth_requests(expires_at);
create table private.external_calendar_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references private.external_calendar_connections(id) on delete cascade,
  lane text not null check(lane in ('staging','production')),
  outcome text not null,
  error_code text,
  event_count integer not null default 0,
  recorded_at timestamptz not null default now()
);
create index external_calendar_runs_connection_idx on private.external_calendar_runs(connection_id);
create index external_calendar_runs_retention_idx on private.external_calendar_runs(recorded_at);

create table public.external_calendar_events_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lane text not null check(lane in ('staging','production')),
  connection_id uuid not null references private.external_calendar_connections(id) on delete cascade,
  source_id uuid not null references private.external_calendar_sources(id) on delete cascade,
  provider text not null check(provider='google'),
  provider_event_id text not null,
  recurrence_id text,
  title text not null,
  detail text,
  location text,
  all_day boolean not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  start_date date,
  end_date date,
  calendar_name text not null,
  color text,
  refreshed_at timestamptz not null default now(),
  check(ends_at > starts_at),
  check((all_day and start_date is not null and end_date > start_date) or
        (not all_day and start_date is null and end_date is null)),
  unique(source_id,provider_event_id)
);
create index external_calendar_events_connection_idx on public.external_calendar_events_v1(connection_id);
create index external_calendar_events_owner_window_idx
  on public.external_calendar_events_v1(user_id,lane,starts_at,ends_at);

alter table private.external_calendar_connections enable row level security;
alter table private.external_calendar_sources enable row level security;
alter table private.external_calendar_oauth_requests enable row level security;
alter table private.external_calendar_runs enable row level security;
alter table public.external_calendar_events_v1 enable row level security;
revoke all on private.external_calendar_connections, private.external_calendar_sources,
  private.external_calendar_oauth_requests, private.external_calendar_runs,
  public.external_calendar_events_v1 from public, anon, authenticated;
grant select on public.external_calendar_events_v1 to authenticated;
create policy external_calendar_owner_read on public.external_calendar_events_v1
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.read_external_calendar_events_v1(p_lane text,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if p_lane is null or p_lane not in ('staging','production') or p_from is null or p_until is null
     or p_until <= p_from or p_until-p_from > interval '2 years' then
    raise invalid_parameter_value using message='invalid_calendar_window';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,'client_event_id','external:'||e.id::text,'provider',e.provider,
    'source_id',coalesce(e.source_id,e.native_source_id),'provider_event_id',e.provider_event_id,'recurrence_id',e.recurrence_id,
    'title',e.title,'detail',e.detail,'location',e.location,'all_day',e.all_day,
    'starts_at',e.starts_at,'ends_at',e.ends_at,'start_date',e.start_date,'end_date',e.end_date,
    'calendar_name',e.calendar_name,'color',e.color
  ) order by e.starts_at,e.id) from public.external_calendar_events_v1 e
  where e.user_id=auth.uid() and e.lane=p_lane
    and ((not e.all_day and e.starts_at < p_until and e.ends_at > p_from)
      or (e.all_day and e.start_date < (p_until at time zone 'UTC')::date+1
        and e.end_date > (p_from at time zone 'UTC')::date-1))), '[]'::jsonb);
end $$;
revoke all on function public.read_external_calendar_events_v1(text,timestamptz,timestamptz) from public,anon;
grant execute on function public.read_external_calendar_events_v1(text,timestamptz,timestamptz) to authenticated;

-- One explicitly service-only boundary owns private state and every projection
-- mutation. User JWTs cannot claim a provider identity or submit Google rows.
create function public.external_calendar_service_v1(
  p_action text,p_user_id uuid,p_lane text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare
  c private.external_calendar_connections%rowtype;
  owned_source private.external_calendar_sources%rowtype;
  o private.external_calendar_oauth_requests%rowtype;
  item jsonb;
  source jsonb;
  selected_ids uuid[];
  supplied_ids uuid[];
  changed integer := 0;
  win_start timestamptz;
  win_end timestamptz;
  token uuid;
begin
  if p_lane is null or p_lane not in ('staging','production') then
    raise invalid_parameter_value using message='invalid_lane';
  end if;
  if p_action='due' then
    return coalesce((select jsonb_agg(jsonb_build_object('user_id',q.user_id,'lane',q.lane)) from (
      select due_connection.user_id,due_connection.lane from private.external_calendar_connections due_connection
      where due_connection.lane=p_lane and due_connection.status='connected' and due_connection.automatic
      and due_connection.next_refresh_at<=now() and (due_connection.lease_until is null or due_connection.lease_until<now())
      and exists(select 1 from private.external_calendar_sources s where s.connection_id=due_connection.id and s.selected)
      order by due_connection.next_refresh_at,due_connection.id limit 5
    ) q),'[]'::jsonb);
  end if;
  if p_action='housekeeping' then
    delete from private.external_calendar_oauth_requests where expires_at<now();
    delete from private.external_calendar_runs where recorded_at<now()-interval '30 days';
    return '{}'::jsonb;
  end if;
  if p_action='consume_oauth' then
    delete from private.external_calendar_oauth_requests where state_hash=p_payload->>'state_hash'
      and lane=p_lane and expires_at>now() returning * into o;
    if not found then raise invalid_parameter_value using message='invalid_oauth_state'; end if;
    return to_jsonb(o);
  end if;
  if p_user_id is null then raise invalid_parameter_value using message='missing_account'; end if;
  -- Serialize all state transitions. A late worker cannot restore a disconnected
  -- connection, reverse a selection, or resurrect a paused provider.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text||':'||p_lane,0));
  select * into c from private.external_calendar_connections
    where user_id=p_user_id and lane=p_lane and provider='google' for update;
  if p_action='create_oauth' then
    delete from private.external_calendar_oauth_requests where user_id=p_user_id and lane=p_lane;
    insert into private.external_calendar_oauth_requests(state_hash,user_id,lane,envelope,expected_connection,expected_generation)
      values(p_payload->>'state_hash',p_user_id,p_lane,p_payload->'envelope',c.id,c.generation);
    return '{}'::jsonb;
  end if;
  if p_action='connect' then
    if (c.id is distinct from (p_payload->>'expected_connection')::uuid) or
       (c.generation is distinct from (p_payload->>'expected_generation')::bigint) then
      raise invalid_parameter_value using message='stale_attempt';
    end if;
    if c.id is not null and c.provider_subject<>p_payload->>'provider_subject' then
      raise invalid_parameter_value using message='account_mismatch';
    end if;
    insert into private.external_calendar_connections(user_id,lane,provider,provider_subject,account_label,credentials)
      values(p_user_id,p_lane,'google',p_payload->>'provider_subject',p_payload->>'account_label',p_payload->'credentials')
    on conflict(user_id,lane,provider) do update set credentials=excluded.credentials,
      account_label=excluded.account_label,status='connected',automatic=true,error_code=null,retry_at=null,
      failure_count=0,generation=private.external_calendar_connections.generation+1,
      lease_token=null,lease_until=null,next_refresh_at=now()
    returning * into c;
    return jsonb_build_object('id',c.id);
  end if;
  if p_action in ('disconnect','pause','resume','select_sources') and c.id is not null and
    (c.generation is distinct from (p_payload->>'expected_revision')::bigint) then
    raise invalid_parameter_value using message='stale_attempt';
  end if;
  if p_action='disconnect' then
    delete from private.external_calendar_oauth_requests where user_id=p_user_id and lane=p_lane;
    delete from private.external_calendar_connections where id=c.id;
    return '{}'::jsonb;
  end if;
  if p_action='status' then
    return jsonb_build_object('connection',case when c.id is null then null else jsonb_build_object(
      'id',c.id,'provider','google','account_label',c.account_label,'status',c.status,
      'automatic',c.automatic,'revision',c.generation,'last_synced_at',c.last_synced_at,'error_code',c.error_code) end,
      'syncing',coalesce(c.lease_until>now(),false),'retry_at',c.retry_at,
      'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'selected',s.selected,
        'color',s.color,'read_only',true,'last_synced_at',s.last_synced_at,'error_code',s.error_code)
        order by lower(s.label),s.id) from private.external_calendar_sources s where s.connection_id=c.id),'[]'::jsonb));
  end if;
  if c.id is null then raise invalid_parameter_value using message='not_connected'; end if;
  if p_action='sources' then
    if c.generation is distinct from (p_payload->>'generation')::bigint or
       c.lease_token is distinct from (p_payload->>'lease_token')::uuid or
       c.lease_token is null or c.lease_until<=now() then
      raise invalid_parameter_value using message='stale_attempt'; end if;
    if jsonb_typeof(p_payload->'sources') is distinct from 'array' then raise invalid_parameter_value; end if;
    for item in select value from jsonb_array_elements(p_payload->'sources') loop
      insert into private.external_calendar_sources(connection_id,provider_calendar_id,label,color)
        values(c.id,item->>'provider_calendar_id',item->>'label',item->>'color')
      on conflict(connection_id,provider_calendar_id) do update set label=excluded.label,color=excluded.color,error_code=null;
    end loop;
    -- Only a fully fetched catalog can remove lost calendars and their copies.
    delete from private.external_calendar_sources s where s.connection_id=c.id and not exists(
      select 1 from jsonb_array_elements(p_payload->'sources') x where x->>'provider_calendar_id'=s.provider_calendar_id);
    update private.external_calendar_connections set generation=generation+1,lease_token=null,lease_until=null where id=c.id;
    return '{}'::jsonb;
  end if;
  if p_action='select_sources' then
    if jsonb_typeof(p_payload->'source_ids') is distinct from 'array' then raise invalid_parameter_value; end if;
    select coalesce(array_agg(value::uuid),array[]::uuid[]) into supplied_ids from jsonb_array_elements_text(p_payload->'source_ids');
    if cardinality(supplied_ids)>50 or exists(select 1 from unnest(supplied_ids) i where not exists(
      select 1 from private.external_calendar_sources s where s.id=i and s.connection_id=c.id)) then
      raise invalid_parameter_value using message='invalid_sources';
    end if;
    update private.external_calendar_sources set selected=(id=any(supplied_ids)) where connection_id=c.id;
    delete from public.external_calendar_events_v1 e where connection_id=c.id and not(source_id=any(supplied_ids));
    update private.external_calendar_connections set generation=generation+1,lease_token=null,lease_until=null,
      next_refresh_at=now(),error_code=null,retry_at=null where id=c.id;
    return '{}'::jsonb;
  end if;
  if p_action in ('pause','resume') then
    if p_action='resume' and c.status='reconnect_required' then
      raise invalid_parameter_value using message='reconnect_required'; end if;
    update private.external_calendar_connections set status=case when p_action='pause' then 'paused' else 'connected' end,
      automatic=(p_action='resume'),generation=generation+1,lease_token=null,lease_until=null,next_refresh_at=now()
      where id=c.id;
    return '{}'::jsonb;
  end if;
  if p_action='claim' then
    -- Explicit authenticated refreshes may import once without re-enabling the
    -- schedule. Workers never request manual permission; every claim still uses
    -- the same generation/lease fence, invalidated by a later pause or resume.
    if c.status<>'connected' and not(c.status='paused' and (
      coalesce((p_payload->>'catalog')::boolean,false) or
      coalesce((p_payload->>'manual')::boolean,false))) then
      raise invalid_parameter_value using message=c.status; end if;
    if c.lease_until>now() then raise lock_not_available using message='sync_busy'; end if;
    token:=gen_random_uuid();
    update private.external_calendar_connections set lease_token=token,lease_until=now()+interval '120 seconds',
      time_zone=coalesce(p_payload->>'time_zone',time_zone) where id=c.id returning * into c;
    return to_jsonb(c)||jsonb_build_object('sources',coalesce((select jsonb_agg(to_jsonb(s))
      from private.external_calendar_sources s where connection_id=c.id and selected),'[]'::jsonb));
  end if;
  if p_action in ('apply','fail','rotate_credentials') then
    if c.lease_token is distinct from (p_payload->>'lease_token')::uuid
      or c.generation is distinct from (p_payload->>'generation')::bigint
      or c.lease_until<=now() or c.lease_token is null then
      raise invalid_parameter_value using message='stale_attempt'; end if;
  end if;
  if p_action='rotate_credentials' then
    update private.external_calendar_connections set credentials=p_payload->'credentials' where id=c.id;
    return '{}'::jsonb;
  end if;
  if p_action='fail' then
    update private.external_calendar_connections set error_code=p_payload->>'error_code',
      status=case when p_payload->>'error_code'='reconnect_required' then 'reconnect_required' else status end,
      failure_count=least(failure_count+1,8),retry_at=now()+make_interval(mins=>least(60,(2^least(failure_count,5))::integer)),
      next_refresh_at=now()+make_interval(mins=>least(60,(2^least(failure_count,5))::integer)),
      lease_token=null,lease_until=null where id=c.id;
    insert into private.external_calendar_runs(connection_id,lane,outcome,error_code)
      values(c.id,p_lane,'failed',p_payload->>'error_code');
    return '{}'::jsonb;
  end if;
  if p_action='apply' then
    win_start:=(p_payload->>'start')::timestamptz; win_end:=(p_payload->>'end')::timestamptz;
    if win_start is null or win_end is null or win_end<=win_start or win_end-win_start>interval '2 years'
      or jsonb_typeof(p_payload->'sources') is distinct from 'array' then raise invalid_parameter_value; end if;
    select coalesce(array_agg(id order by id),array[]::uuid[]) into selected_ids
      from private.external_calendar_sources where connection_id=c.id and selected;
    select coalesce(array_agg((value->>'id')::uuid order by (value->>'id')::uuid),array[]::uuid[]) into supplied_ids
      from jsonb_array_elements(p_payload->'sources');
    if selected_ids<>supplied_ids then raise invalid_parameter_value using message='incomplete_snapshot'; end if;
    for source in select value from jsonb_array_elements(p_payload->'sources') loop
      select * into strict owned_source from private.external_calendar_sources where id=(source->>'id')::uuid and connection_id=c.id and selected;
      if jsonb_typeof(source->'events') is distinct from 'array' or jsonb_array_length(source->'events')>50000 then raise invalid_parameter_value; end if;
      if exists(select 1 from jsonb_array_elements(source->'events') e group by e->>'provider_event_id' having count(*)>1) then
        raise invalid_parameter_value using message='duplicate_occurrence'; end if;
      insert into public.external_calendar_events_v1(user_id,lane,connection_id,source_id,provider,provider_event_id,
        recurrence_id,title,detail,location,all_day,starts_at,ends_at,start_date,end_date,calendar_name,color)
      select c.user_id,c.lane,c.id,owned_source.id,'google',e.provider_event_id,e.recurrence_id,e.title,e.detail,e.location,
        e.all_day,e.starts_at,e.ends_at,e.start_date,e.end_date,owned_source.label,owned_source.color
      from jsonb_to_recordset(source->'events') as e(provider_event_id text,recurrence_id text,title text,detail text,location text,
        all_day boolean,starts_at timestamptz,ends_at timestamptz,start_date date,end_date date)
      on conflict(source_id,provider_event_id) do update set recurrence_id=excluded.recurrence_id,
        title=excluded.title,detail=excluded.detail,location=excluded.location,all_day=excluded.all_day,
        starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=excluded.start_date,end_date=excluded.end_date,
        calendar_name=excluded.calendar_name,color=excluded.color,refreshed_at=now();
      changed:=changed+jsonb_array_length(source->'events');
      -- Date-only rows get a one-day boundary allowance for provider timezone offsets.
      delete from public.external_calendar_events_v1 e where e.source_id=owned_source.id
        and ((not e.all_day and e.starts_at<win_end and e.ends_at>win_start)
          or(e.all_day and e.start_date<(win_end at time zone 'UTC')::date+1 and e.end_date>(win_start at time zone 'UTC')::date-1))
        and not exists(select 1 from jsonb_array_elements(source->'events') x where x->>'provider_event_id'=e.provider_event_id);
      update private.external_calendar_sources set last_synced_at=now(),error_code=null where id=owned_source.id;
    end loop;
    update private.external_calendar_connections set last_synced_at=now(),error_code=null,retry_at=null,failure_count=0,
      next_refresh_at=now()+interval '15 minutes',lease_token=null,lease_until=null where id=c.id;
    insert into private.external_calendar_runs(connection_id,lane,outcome,event_count) values(c.id,p_lane,'completed',changed);
    return jsonb_build_object('changed',changed);
  end if;
  raise invalid_parameter_value using message='invalid_action';
end $$;
revoke all on function public.external_calendar_service_v1(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.external_calendar_service_v1(text,uuid,text,jsonb) to service_role;

-- Installation is inert until a new, dedicated Vault secret is configured.
-- No existing delivery schedules or credentials are changed.
do $$ begin
  if to_regnamespace('cron') is not null and to_regnamespace('net') is not null and to_regclass('vault.decrypted_secrets') is not null then
    perform cron.schedule('external_calendar_refresh_1m','* * * * *',$job$
      select net.http_post(
        url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/external_calendar/worker',
        headers:=jsonb_build_object('Content-Type','application/json','x-external-calendar-secret',
          (select decrypted_secret from vault.decrypted_secrets where name='external_calendar_worker_secret')),
        body:='{}'::jsonb,timeout_milliseconds:=100000
      ) where exists(select 1 from vault.decrypted_secrets where name='external_calendar_worker_secret')
        and exists(select 1 from vault.decrypted_secrets where name='project_url');
    $job$);
  end if;
end $$;

-- Device ingestion has its own connection, device owner, and natural identities.
-- It cannot submit or update a Google-owned source under any action.
create table private.external_calendar_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lane text not null check(lane in ('staging','production')),
  owner_device_id text not null check(length(owner_device_id) between 16 and 200),
  status text not null default 'paused' check(status in ('connected','paused')),
  generation bigint not null default 1,
  last_synced_at timestamptz,
  unique(user_id,lane)
);
create table private.external_calendar_device_sources (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.external_calendar_devices(id) on delete cascade,
  native_id text not null,
  label text not null,
  account_label text,
  kind text,
  color text,
  selected boolean not null default false,
  available boolean not null default true,
  owned_by text not null default 'device' check(owned_by in ('device','google')),
  google_source_id uuid references private.external_calendar_sources(id) on delete set null,
  last_synced_at timestamptz,
  unique(connection_id,native_id)
);
create index external_calendar_device_google_source_idx on private.external_calendar_device_sources(google_source_id) where google_source_id is not null;
alter table private.external_calendar_devices enable row level security;
alter table private.external_calendar_device_sources enable row level security;
revoke all on private.external_calendar_devices,private.external_calendar_device_sources from public,anon,authenticated;
alter table public.external_calendar_events_v1 alter column connection_id drop not null;
alter table public.external_calendar_events_v1 alter column source_id drop not null;
alter table public.external_calendar_events_v1 drop constraint external_calendar_events_v1_provider_check;
alter table public.external_calendar_events_v1 add column native_connection_id uuid references private.external_calendar_devices(id) on delete cascade;
alter table public.external_calendar_events_v1 add column native_source_id uuid references private.external_calendar_device_sources(id) on delete cascade;
alter table public.external_calendar_events_v1 add constraint external_calendar_provider_ownership check(
  (provider='google' and connection_id is not null and source_id is not null and native_connection_id is null and native_source_id is null)
  or (provider='device' and connection_id is null and source_id is null and native_connection_id is not null and native_source_id is not null and recurrence_id is not null));
create index external_calendar_native_connection_idx on public.external_calendar_events_v1(native_connection_id);
create unique index external_calendar_native_occurrence_idx on public.external_calendar_events_v1(native_source_id,provider_event_id,recurrence_id);

create function public.external_calendar_device_service_v1(p_action text,p_user_id uuid,p_lane text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare
  c private.external_calendar_devices%rowtype;
  owned_source private.external_calendar_device_sources%rowtype;
  item jsonb;
  source jsonb;
  ids uuid[];
  expected uuid[];
  supplied uuid[];
  win_start timestamptz;
  win_end timestamptz;
  changed integer:=0;
begin
  if p_user_id is null or p_lane is null or p_lane not in ('staging','production') then raise invalid_parameter_value; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text||':'||p_lane||':device',0));
  select * into c from private.external_calendar_devices where user_id=p_user_id and lane=p_lane for update;
  if p_action='device_status' then
    return jsonb_build_object('available',true,'connection',case when c.id is null then null else jsonb_build_object(
      'id',c.id,'provider','device','owner_device_id',c.owner_device_id,'status',c.status,'revision',c.generation,
      'automatic',c.status='connected','last_synced_at',c.last_synced_at) end,
      'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'native_id',s.native_id,'label',s.label,
        'account_label',s.account_label,'kind',s.kind,'color',s.color,'selected',s.selected,'available',s.available,
        'owned_by',s.owned_by,'google_source_id',s.google_source_id,'last_synced_at',s.last_synced_at) order by lower(s.label),s.id)
        from private.external_calendar_device_sources s where s.connection_id=c.id),'[]'::jsonb));
  end if;
  if length(coalesce(p_payload->>'device_id','')) not between 16 and 200 then
    raise invalid_parameter_value using message='invalid_device'; end if;
  if c.id is not null and c.generation is distinct from (p_payload->>'expected_revision')::bigint then
    raise invalid_parameter_value using message='stale_attempt'; end if;
  if p_action='device_connect' then
    if jsonb_typeof(p_payload->'sources') is distinct from 'array' or jsonb_array_length(p_payload->'sources')>5000 then
      raise invalid_parameter_value; end if;
    if c.id is not null and c.owner_device_id<>p_payload->>'device_id' then
      if coalesce((p_payload->>'replace_device')::boolean,false) is not true then
        raise insufficient_privilege using message='device_owner_conflict'; end if;
      delete from private.external_calendar_devices where id=c.id; c.id:=null;
    end if;
    if c.id is null then
      insert into private.external_calendar_devices(user_id,lane,owner_device_id)
        values(p_user_id,p_lane,p_payload->>'device_id') returning * into c;
    else
      update private.external_calendar_devices set generation=generation+1 where id=c.id returning * into c;
    end if;
    update private.external_calendar_device_sources set available=false where connection_id=c.id;
    for item in select value from jsonb_array_elements(p_payload->'sources') loop
      if length(coalesce(item->>'native_id','')) not between 1 and 2048 or length(coalesce(item->>'label','')) not between 1 and 1000 then
        raise invalid_parameter_value; end if;
      insert into private.external_calendar_device_sources(connection_id,native_id,label,account_label,kind,color)
        values(c.id,item->>'native_id',item->>'label',item->>'account_label',item->>'kind',item->>'color')
      on conflict(connection_id,native_id) do update set label=excluded.label,account_label=excluded.account_label,
        kind=excluded.kind,color=excluded.color,available=true;
    end loop;
    return public.external_calendar_device_service_v1('device_status',p_user_id,p_lane,'{}');
  end if;
  if c.id is null then raise invalid_parameter_value using message='not_connected'; end if;
  if c.owner_device_id<>p_payload->>'device_id' then raise insufficient_privilege using message='device_owner_conflict'; end if;
  if p_action='device_disconnect' then
    delete from private.external_calendar_devices where id=c.id;
    return public.external_calendar_device_service_v1('device_status',p_user_id,p_lane,'{}');
  end if;
  if p_action in ('device_pause','device_resume') then
    update private.external_calendar_devices set status=case when p_action='device_pause' then 'paused' else 'connected' end,
      generation=generation+1 where id=c.id;
    return public.external_calendar_device_service_v1('device_status',p_user_id,p_lane,'{}');
  end if;
  if p_action='device_select_sources' then
    if jsonb_typeof(p_payload->'source_ids') is distinct from 'array' then raise invalid_parameter_value; end if;
    select coalesce(array_agg(value::uuid),array[]::uuid[]) into ids from jsonb_array_elements_text(p_payload->'source_ids');
    if cardinality(ids)>50 or exists(select 1 from unnest(ids) i where not exists(
      select 1 from private.external_calendar_device_sources s where s.id=i and s.connection_id=c.id and s.available)) then
      raise invalid_parameter_value using message='invalid_sources'; end if;
    update private.external_calendar_device_sources set selected=(id=any(ids)),google_source_id=null,owned_by='device' where connection_id=c.id;
    for owned_source in select * from private.external_calendar_device_sources where connection_id=c.id loop
      if (p_payload->'google_bindings') ? owned_source.id::text then
        if not exists(select 1 from private.external_calendar_sources gs
          join private.external_calendar_connections gc on gc.id=gs.connection_id
          where gs.id=((p_payload->'google_bindings')->>owned_source.id::text)::uuid and gc.user_id=p_user_id and gc.lane=p_lane) then
          raise invalid_parameter_value using message='invalid_sources'; end if;
        update private.external_calendar_device_sources set owned_by='google',google_source_id=((p_payload->'google_bindings')->>owned_source.id::text)::uuid where id=owned_source.id;
      end if;
    end loop;
    delete from public.external_calendar_events_v1 e where native_connection_id=c.id and not exists(
      select 1 from private.external_calendar_device_sources s where s.id=e.native_source_id and s.selected and s.owned_by='device');
    update private.external_calendar_devices set generation=generation+1 where id=c.id;
    return public.external_calendar_device_service_v1('device_status',p_user_id,p_lane,'{}');
  end if;
  if p_action='device_snapshot' then
    if c.status<>'connected' and coalesce((p_payload->>'manual')::boolean,false) is not true then raise invalid_parameter_value using message='paused'; end if;
    win_start:=(p_payload->>'start')::timestamptz;win_end:=(p_payload->>'end')::timestamptz;
    if win_start is null or win_end is null or win_end<=win_start or win_end-win_start>interval '730 days'
      or jsonb_typeof(p_payload->'sources') is distinct from 'array' then raise invalid_parameter_value; end if;
    if exists(select 1 from private.external_calendar_device_sources where connection_id=c.id and selected and not available and owned_by='device') then
      raise invalid_parameter_value using message='source_unavailable'; end if;
    select coalesce(array_agg(id order by id),array[]::uuid[]) into expected from private.external_calendar_device_sources
      where connection_id=c.id and selected and owned_by='device';
    select coalesce(array_agg((value->>'id')::uuid order by (value->>'id')::uuid),array[]::uuid[]) into supplied
      from jsonb_array_elements(p_payload->'sources');
    if expected<>supplied then raise invalid_parameter_value using message='incomplete_snapshot'; end if;
    if (select coalesce(sum(jsonb_array_length(x->'events')),0) from jsonb_array_elements(p_payload->'sources') x)>50000 then raise invalid_parameter_value; end if;
    for source in select value from jsonb_array_elements(p_payload->'sources') loop
      select * into strict owned_source from private.external_calendar_device_sources where id=(source->>'id')::uuid and connection_id=c.id;
      if jsonb_typeof(source->'events') is distinct from 'array' then raise invalid_parameter_value; end if;
      if exists(select 1 from jsonb_array_elements(source->'events') e group by e->>'provider_event_id',e->>'recurrence_id' having count(*)>1) then
        raise invalid_parameter_value using message='duplicate_occurrence'; end if;
      insert into public.external_calendar_events_v1(user_id,lane,native_connection_id,native_source_id,provider,provider_event_id,
        recurrence_id,title,detail,location,all_day,starts_at,ends_at,start_date,end_date,calendar_name,color)
      select c.user_id,c.lane,c.id,owned_source.id,'device',e.provider_event_id,e.recurrence_id,e.title,e.detail,e.location,e.all_day,
        e.starts_at,e.ends_at,e.start_date,e.end_date,owned_source.label,owned_source.color
      from jsonb_to_recordset(source->'events') as e(provider_event_id text,recurrence_id text,title text,detail text,location text,
        all_day boolean,starts_at timestamptz,ends_at timestamptz,start_date date,end_date date)
      on conflict(native_source_id,provider_event_id,recurrence_id) do update set title=excluded.title,detail=excluded.detail,location=excluded.location,
        all_day=excluded.all_day,starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=excluded.start_date,end_date=excluded.end_date,
        calendar_name=excluded.calendar_name,color=excluded.color,refreshed_at=now();
      changed:=changed+jsonb_array_length(source->'events');
      delete from public.external_calendar_events_v1 e where native_source_id=owned_source.id and e.starts_at<win_end and e.ends_at>win_start
        and not exists(select 1 from jsonb_array_elements(source->'events') x where x->>'provider_event_id'=e.provider_event_id and x->>'recurrence_id'=e.recurrence_id);
      update private.external_calendar_device_sources set last_synced_at=now() where id=owned_source.id;
    end loop;
    update private.external_calendar_devices set generation=generation+1,last_synced_at=now() where id=c.id;
    return public.external_calendar_device_service_v1('device_status',p_user_id,p_lane,'{}')||jsonb_build_object('changed',changed);
  end if;
  raise invalid_parameter_value using message='invalid_action';
end $$;
revoke all on function public.external_calendar_device_service_v1(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.external_calendar_device_service_v1(text,uuid,text,jsonb) to service_role;
