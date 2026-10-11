-- Keep the single device import RPC and its service-only privileges.
create or replace function public.external_calendar_device_service_v1(p_action text,p_user_id uuid,p_lane text,p_payload jsonb)
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
  -- Removing imported copies is an account operation. Native inventory and
  -- snapshot writes below still require the explicitly owning device.
  if p_action='device_remove_source' then
    if c.id is null then raise invalid_parameter_value using message='not_connected'; end if;
    if c.generation is distinct from (p_payload->>'expected_revision')::bigint then
      raise invalid_parameter_value using message='stale_attempt'; end if;
    select * into owned_source from private.external_calendar_device_sources
      where id=(p_payload->>'source_id')::uuid and connection_id=c.id;
    if owned_source.id is null or owned_source.owned_by<>'device' then
      raise invalid_parameter_value using message='invalid_sources'; end if;
    if owned_source.selected then
      update private.external_calendar_device_sources set selected=false where id=owned_source.id;
      delete from public.external_calendar_events_v1
        where native_connection_id=c.id and native_source_id=owned_source.id;
      update private.external_calendar_devices set generation=generation+1 where id=c.id;
    end if;
    return public.external_calendar_device_service_v1('device_status',p_user_id,p_lane,'{}');
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
