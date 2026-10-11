-- Calendar setup truth and grant reuse in the existing service owner.
-- No new tables, credential stores, RPCs, or projection writers.
create or replace function public.external_calendar_service_v1(
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
    -- Credential fallback stays server-only and is fenced to the exact connection
    -- that initiated this one-use request. Never reuse a revoked grant.
    select * into c from private.external_calendar_connections
      where id=o.expected_connection and user_id=o.user_id and lane=o.lane
      and generation=o.expected_generation;
    return to_jsonb(o)||jsonb_build_object('provider_subject',c.provider_subject,
      'reusable_credentials',case when c.status in ('connected','paused') then c.credentials else null end);
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
    return jsonb_build_object('provider_subject',c.provider_subject,
      'reuse_grant',coalesce(c.status in ('connected','paused'),false));
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
      account_label=excluded.account_label,
      status=case when private.external_calendar_connections.automatic then 'connected' else 'paused' end,
      error_code=null,retry_at=null,
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
      'imported_event_count',(select count(*) from public.external_calendar_events_v1 e where e.connection_id=c.id),
      'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'selected',s.selected,
        'color',s.color,'read_only',true,'last_synced_at',s.last_synced_at,'error_code',s.error_code,
        'imported_event_count',(select count(*) from public.external_calendar_events_v1 e where e.source_id=s.id))
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
    if not coalesce((p_payload->>'catalog')::boolean,false) and not exists(
      select 1 from private.external_calendar_sources s where s.connection_id=c.id and s.selected) then
      raise invalid_parameter_value using message='no_calendars_selected'; end if;
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
    if cardinality(selected_ids)=0 then raise invalid_parameter_value using message='no_calendars_selected'; end if;
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
