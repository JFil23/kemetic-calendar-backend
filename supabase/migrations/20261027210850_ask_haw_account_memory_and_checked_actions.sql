begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Account content, never an evictable warm cache. Only fenced RPCs may write it.
create table private.ask_haw_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  epoch bigint not null default 0 check (epoch >= 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
  updated_at timestamptz not null default now()
);
create table private.ask_haw_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  domain text not null check (domain in ('memory','actions')),
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,mutation_id)
);
alter table private.ask_haw_memory enable row level security;
alter table private.ask_haw_mutation_receipts enable row level security;
create policy ask_haw_memory_owner on private.ask_haw_memory to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy ask_haw_receipts_owner on private.ask_haw_mutation_receipts to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on private.ask_haw_memory,private.ask_haw_mutation_receipts from public,anon,authenticated;

create function private.ask_haw_merge(p_before jsonb,p_patch jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_result jsonb:=p_before; v_key text; v_value jsonb;
begin
  for v_key,v_value in select key,value from jsonb_each(p_patch) loop
    if v_value='null'::jsonb then v_result:=v_result-v_key;
    elsif jsonb_typeof(v_value)='object' then
      v_result:=jsonb_set(v_result,array[v_key],private.ask_haw_merge(
        case when jsonb_typeof(v_result->v_key)='object' then v_result->v_key else '{}'::jsonb end,v_value));
    else v_result:=jsonb_set(v_result,array[v_key],v_value); end if;
  end loop;
  return v_result;
end $$;
revoke all on function private.ask_haw_merge(jsonb,jsonb) from public,anon,authenticated;

create function private.read_ask_haw_memory(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_row jsonb;
begin
  if auth.uid() is null or p_account is distinct from auth.uid() then raise insufficient_privilege using message='Not authenticated'; end if;
  select jsonb_build_object('revision',m.revision,'epoch',m.epoch,'payload',m.payload) into v_row
    from private.ask_haw_memory m where m.user_id=p_account;
  return jsonb_build_object('status','ready','row',coalesce(v_row,jsonb_build_object('revision',0,'epoch',0,'payload','{}'::jsonb)));
end $$;
create function public.read_ask_haw_memory_v1(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.read_ask_haw_memory(p_account) $$;

create function private.apply_ask_haw_memory(
  p_account uuid,p_mutation uuid,p_expected_revision bigint,p_expected_epoch bigint,p_operation text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_memory private.ask_haw_memory%rowtype; v_receipt private.ask_haw_mutation_receipts%rowtype;
  v_request jsonb; v_result jsonb; v_row jsonb;
begin
  if auth.uid() is null or p_account is distinct from auth.uid() then raise insufficient_privilege using message='Not authenticated'; end if;
  if p_mutation is null or p_expected_revision is null or p_expected_epoch is null or p_expected_revision<0 or p_expected_epoch<0
    or p_operation is null or p_operation not in ('patch','clear') or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>65536 then raise invalid_parameter_value using message='Invalid memory mutation'; end if;
  v_request:=jsonb_build_object('operation',p_operation,'payload',p_payload,'revision',p_expected_revision,'epoch',p_expected_epoch);
  perform pg_advisory_xact_lock(hashtextextended('ask-haw-account:'||p_account::text,0));
  insert into private.ask_haw_memory(user_id) values(p_account) on conflict do nothing;
  select * into v_memory from private.ask_haw_memory where user_id=p_account for update;
  v_row:=jsonb_build_object('revision',v_memory.revision,'epoch',v_memory.epoch,'payload',v_memory.payload);
  select * into v_receipt from private.ask_haw_mutation_receipts where user_id=p_account and mutation_id=p_mutation;
  if found then
    if v_receipt.domain<>'memory' or v_receipt.request<>v_request then raise invalid_parameter_value using message='Mutation identity reused with different content'; end if;
    if (v_receipt.result#>>'{row,epoch}')::bigint<>v_memory.epoch then return jsonb_build_object('status','superseded','row',v_row); end if;
    return v_receipt.result;
  end if;
  if v_memory.revision<>p_expected_revision or v_memory.epoch<>p_expected_epoch then
    v_result:=jsonb_build_object('status','conflict','row',v_row);
  else
    update private.ask_haw_memory set
      payload=case when p_operation='clear' then '{}'::jsonb else private.ask_haw_merge(payload,p_payload) end,
      revision=revision+1,epoch=epoch+case when p_operation='clear' then 1 else 0 end,updated_at=now()
      where user_id=p_account returning * into v_memory;
    v_result:=jsonb_build_object('status','applied','row',jsonb_build_object('revision',v_memory.revision,'epoch',v_memory.epoch,'payload',v_memory.payload));
  end if;
  insert into private.ask_haw_mutation_receipts(user_id,mutation_id,domain,request,result) values(p_account,p_mutation,'memory',v_request,v_result);
  return v_result;
end $$;
create function public.apply_ask_haw_memory_v1(
  p_account uuid,p_mutation uuid,p_expected_revision bigint,p_expected_epoch bigint,p_operation text,p_payload jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.apply_ask_haw_memory(p_account,p_mutation,p_expected_revision,p_expected_epoch,p_operation,p_payload)
$$;

-- Old clients continue writing the established owners. Every write advances
-- revisions, so a proposal cannot overwrite an intervening direct edit.
alter table public.user_events add column event_revision bigint not null default 1 check(event_revision>0),
  add column flow_suspended boolean not null default false,
  add column ask_haw_period_key text;
alter table public.flows add column assistance jsonb check(assistance is null or (jsonb_typeof(assistance)='object' and octet_length(assistance::text)<=65536)),
  add column assistance_revision bigint not null default 1 check(assistance_revision>0),
  add column paused_at timestamptz;
alter table public.scheduled_notifications add column flow_pause_suppressed boolean not null default false;
create function private.ask_haw_flow_revision() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.assistance_revision:=1; else new.assistance_revision:=old.assistance_revision+1; end if;
  return new;
end $$;
create trigger ask_haw_flow_revision before insert or update on public.flows for each row execute function private.ask_haw_flow_revision();

create function private.ask_haw_event_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare v_paused timestamptz; v_source_id bigint; v_source_user uuid; v_step text; v_period_start timestamptz;
begin
  if tg_op='INSERT' then new.event_revision:=1; else new.event_revision:=old.event_revision+1; end if;
  select f.id,f.user_id,f.paused_at into v_source_id,v_source_user,v_paused from public.flows f
    where f.calendar_id=new.calendar_id and f.id=coalesce(
      public.user_event_referenced_flow_id(new.flow_local_id,new.client_event_id,new.detail),
      public.flow_id_from_action_id(new.user_id,new.action_id));
  v_step:=nullif(new.behavior_payload#>>'{ask_haw,step_id}','');
  if v_step is not null and v_source_id is not null then
    v_period_start:=new.starts_at;
    if tg_op='UPDATE' and old.behavior_payload#>>'{ask_haw,step_id}'=v_step and old.flow_local_id is not distinct from new.flow_local_id then
      v_period_start:=old.starts_at;
      new.ask_haw_period_key:=old.ask_haw_period_key;
    else new.ask_haw_period_key:=null; end if;
    new.ask_haw_period_key:=coalesce(new.ask_haw_period_key,'day:'||to_char(v_period_start at time zone coalesce(nullif(public._get_user_timezone(v_source_user),''),'UTC'),'YYYY-MM-DD'));
  else new.ask_haw_period_key:=null; end if;
  if v_paused is not null and new.starts_at>=v_paused then new.flow_suspended:=true;
  elsif tg_op='INSERT' then new.flow_suspended:=false;
  elsif new.starts_at is distinct from old.starts_at or new.flow_local_id is distinct from old.flow_local_id then new.flow_suspended:=false;
  end if;
  return new;
end $$;
create trigger ask_haw_event_revision before insert or update on public.user_events for each row execute function private.ask_haw_event_revision();

-- A pause is an overlay, never End Flow. History and completion rows survive.
-- Resume releases future occurrences; elapsed paused occurrences stay recorded
-- as suspended and never become a burst of overdue notifications.
create function private.ask_haw_apply_pause() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.paused_at is not distinct from old.paused_at then return new; end if;
  update public.user_events e set flow_suspended=(new.paused_at is not null)
    where e.calendar_id=new.calendar_id and e.starts_at>=coalesce(new.paused_at,now())
      and public.user_event_matches_flow(new.id,e.flow_local_id,e.client_event_id,e.detail,e.action_id,new.ai_metadata);
  if new.paused_at is not null then
    update public.scheduled_notifications n set is_active=false,flow_pause_suppressed=true,claimed_at=null,claim_token=null
      where n.is_active and n.scheduled_at>=new.paused_at and exists(
        select 1 from public.user_events e where e.calendar_id=new.calendar_id and e.client_event_id=n.client_event_id
          and e.flow_suspended and public.user_event_matches_flow(new.id,e.flow_local_id,e.client_event_id,e.detail,e.action_id,new.ai_metadata));
  else
    update public.scheduled_notifications n set is_active=(n.scheduled_at>=now()),flow_pause_suppressed=false
      where n.flow_pause_suppressed and exists(
        select 1 from public.user_events e where e.calendar_id=new.calendar_id and e.client_event_id=n.client_event_id
          and public.user_event_matches_flow(new.id,e.flow_local_id,e.client_event_id,e.detail,e.action_id,new.ai_metadata));
  end if;
  return new;
end $$;
create trigger ask_haw_apply_pause after update of paused_at on public.flows for each row execute function private.ask_haw_apply_pause();
create function private.ask_haw_notification_pause() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.is_active and exists(select 1 from public.user_events e where e.client_event_id=new.client_event_id and e.flow_suspended) then
    new.is_active:=false; new.flow_pause_suppressed:=true;
  end if;
  return new;
end $$;
create trigger ask_haw_notification_pause before insert or update on public.scheduled_notifications for each row execute function private.ask_haw_notification_pause();

create function private.ask_haw_can_edit_calendar(p_account uuid,p_calendar uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid()=p_account and exists(select 1 from public.shared_calendar_members m join public.shared_calendars c on c.id=m.calendar_id
    where m.user_id=p_account and m.calendar_id=p_calendar and m.status='accepted' and m.role in('owner','editor') and c.deleted_at is null)
$$;

create function private.ask_haw_event_end(p_starts timestamptz,p_ends timestamptz,p_all_day boolean,p_timezone text) returns timestamptz
language sql immutable set search_path='' as $$
  select greatest(coalesce(p_ends,p_starts),case when coalesce(p_all_day,false) then
    ((p_starts at time zone p_timezone)::date+1)::timestamp at time zone p_timezone else p_starts+interval '1 microsecond' end)
$$;
revoke all on function private.ask_haw_event_end(timestamptz,timestamptz,boolean,text) from public,anon,authenticated;

-- Pure authored-data validation; flags in an event never grant an adaptation.
create function private.ask_haw_validate_step(p_contract jsonb,p_behavior jsonb,p_starts timestamptz,p_ends timestamptz,p_shorten boolean) returns void
language plpgsql immutable set search_path='' as $$
declare v_declared jsonb:=p_behavior->'ask_haw'; v_step jsonb; v_alternative jsonb; v_minutes integer; v_counts boolean;
begin
  if not p_shorten and v_declared is null then return; end if;
  if p_contract is null or p_contract->>'version' is distinct from '1' or v_declared is null or v_declared->>'contract_version' is distinct from '1'
    or jsonb_typeof(p_contract->'steps')<>'array' then raise invalid_parameter_value using message='Unsupported authored assistance'; end if;
  select value into v_step from jsonb_array_elements(p_contract->'steps') where value->>'id'=v_declared->>'step_id';
  if v_step is null then raise invalid_parameter_value using message='Unknown authored step'; end if;
  if p_shorten and not coalesce(p_contract->'adaptations' @> '["shorten"]'::jsonb,false) then raise invalid_parameter_value using message='Shortening is not authored'; end if;
  if nullif(v_declared->>'alternative_id','') is not null then
    select value into v_alternative from jsonb_array_elements(coalesce(v_step->'alternatives','[]'::jsonb)) where value->>'id'=v_declared->>'alternative_id';
    if v_alternative is null then raise invalid_parameter_value using message='Unknown authored alternative'; end if;
    v_minutes:=(v_alternative->>'minutes')::integer; v_counts:=coalesce((v_alternative->>'countsAsCompletion')::boolean,false);
  else
    if p_shorten then raise invalid_parameter_value using message='Shortening needs an authored alternative'; end if;
    v_minutes:=(v_step->>'minutes')::integer; v_counts:=true;
  end if;
  if (v_declared->>'counts_as_completion')::boolean is distinct from v_counts then raise invalid_parameter_value using message='Completion meaning differs from authored alternative'; end if;
  if v_minutes is not null and (v_minutes<=0 or p_ends is null or p_ends-p_starts<>make_interval(mins=>v_minutes)) then raise invalid_parameter_value using message='Duration differs from authored step'; end if;
end $$;
revoke all on function private.ask_haw_validate_step(jsonb,jsonb,timestamptz,timestamptz,boolean) from public,anon,authenticated;

-- Catalog astronomy owns these intervals. Protect Time is an ordinary
-- calendar block with its existing distinct action/payload ownership stamp.
create function private.ask_haw_is_sky_anchor(p_event public.user_events,p_flow public.flows) returns boolean
language sql immutable set search_path='' as $$
  select not coalesce(p_event.action_id='follow_the_sky.protect_time' and p_event.behavior_payload->>'createdBy'='follow_the_sky',false)
    and coalesce(p_event.behavior_payload->>'kind'='track_sky_v2'
      or (p_event.behavior_payload->>'trackSkySchemaVersion'='2' and nullif(p_event.behavior_payload->>'skyEventId','') is not null)
      or p_flow.ai_metadata->>'flow_key'='track-the-sky'
      or p_flow.notes~'(^|;)maat=track-the-sky(;|$)',false)
$$;
revoke all on function private.ask_haw_is_sky_anchor(public.user_events,public.flows) from public,anon,authenticated;
create index user_events_ask_haw_step_lookup_idx on public.user_events(flow_local_id,(behavior_payload#>>'{ask_haw,step_id}'))
  where nullif(behavior_payload#>>'{ask_haw,step_id}','') is not null;

create function private.apply_ask_haw_actions(p_account uuid,p_mutation uuid,p_actions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_action jsonb; v_kind text; v_patch jsonb; v_event public.user_events%rowtype; v_flow public.flows%rowtype;
  v_receipt private.ask_haw_mutation_receipts%rowtype; v_result jsonb; v_rows jsonb:='[]'::jsonb; v_conflicts jsonb:='[]'::jsonb;
  v_calendar uuid; v_cid text; v_target text; v_seen text[]:='{}'; v_after jsonb;
  v_proposals jsonb:='[]'::jsonb; v_proposal jsonb; v_other jsonb; v_busy public.user_events%rowtype; v_start timestamptz; v_end timestamptz; v_timezone text; v_shortens boolean; v_step text; v_period text; v_source_timezone text; v_recurring boolean; v_reservation text; v_reservations text[]:='{}';
begin
  if auth.uid() is null or p_account is distinct from auth.uid() then raise insufficient_privilege using message='Not authenticated'; end if;
  if p_mutation is null or p_actions is null or jsonb_typeof(p_actions)<>'array' or jsonb_array_length(p_actions) not between 1 and 50
    or octet_length(p_actions::text)>262144 then raise invalid_parameter_value using message='Invalid action batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ask-haw-account:'||p_account::text,0));
  select * into v_receipt from private.ask_haw_mutation_receipts where user_id=p_account and mutation_id=p_mutation;
  if found then
    if v_receipt.domain<>'actions' or v_receipt.request<>p_actions then raise invalid_parameter_value using message='Mutation identity reused with different content'; end if;
    return v_receipt.result;
  end if;
  -- Saves are rare and bounded. This short write lock also serializes older
  -- direct writers and accepted shared-calendar editors that do not participate
  -- in Ask's account advisory lock. Reads stay available throughout validation.
  if exists(select 1 from jsonb_array_elements(p_actions) a where coalesce((a->>'avoid_conflicts')::boolean,false)) then
    lock table public.user_events in share row exclusive mode;
    lock table public.external_calendar_events_v1 in share mode;
  end if;
  v_timezone:=coalesce(nullif(public._get_user_timezone(p_account),''),'UTC');
  -- Lock targets in a stable order before validating anything, including creates.
  for v_action in select value from jsonb_array_elements(p_actions) order by value->>'kind',coalesce(value->>'id',value->>'client_event_id') loop
    v_kind:=v_action->>'kind';
    if v_kind is null or v_kind not in('event_patch','event_create','flow_pause','flow_resume','flow_assistance') then raise invalid_parameter_value using message='Unsupported action'; end if;
    v_target:=case when v_kind like 'flow_%' then 'flow:' else 'event:' end||coalesce(v_action->>'id',v_action->>'client_event_id','');
    if v_target=any(v_seen) then raise invalid_parameter_value using message='Duplicate action target'; end if;
    v_seen:=array_append(v_seen,v_target);
    perform pg_advisory_xact_lock(hashtextextended('ask-haw-target:'||v_target,1));
    if v_kind='event_patch' then
      select * into v_event from public.user_events where id=(v_action->>'id')::uuid for update;
      if not found or not private.ask_haw_can_edit_calendar(p_account,v_event.calendar_id) then raise insufficient_privilege using message='Event not editable'; end if;
      if (v_action->>'expected_revision')::bigint is distinct from v_event.event_revision then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind',v_kind,'row',to_jsonb(v_event))); end if;
      v_patch:=v_action->'patch';
      if v_patch is null or jsonb_typeof(v_patch)<>'object' or v_patch='{}'::jsonb or exists(select 1 from jsonb_object_keys(v_patch) k where k not in('title','detail','location','all_day','starts_at','ends_at','behavior_payload')) then raise invalid_parameter_value using message='Invalid event patch'; end if;
      if lower(coalesce(v_event.category,''))='tombstone' then raise invalid_parameter_value using message='Deleted event is not editable'; end if;
      if v_patch?'behavior_payload' and (jsonb_typeof(v_patch->'behavior_payload')<>'object' or
        ((v_patch->'behavior_payload')-'ask_haw'::text) is distinct from (coalesce(v_event.behavior_payload,'{}'::jsonb)-'ask_haw'::text)) then raise invalid_parameter_value using message='Unrelated behavior metadata is immutable'; end if;
      v_after:=to_jsonb(v_event)||v_patch;
      v_shortens:=v_event.ends_at is not null and (v_after->>'ends_at') is not null and
        (v_after->>'ends_at')::timestamptz-(v_after->>'starts_at')::timestamptz<v_event.ends_at-v_event.starts_at;
      select * into v_flow from public.flows f where f.calendar_id=v_event.calendar_id and f.id=coalesce(
        public.user_event_referenced_flow_id(v_event.flow_local_id,v_event.client_event_id,v_event.detail),public.flow_id_from_action_id(v_event.user_id,v_event.action_id)) for update;
      if private.ask_haw_is_sky_anchor(v_event,v_flow) and (
        v_event.starts_at is distinct from (v_after->>'starts_at')::timestamptz
        or v_event.ends_at is distinct from (v_after->>'ends_at')::timestamptz
        or v_event.all_day is distinct from (v_after->>'all_day')::boolean
      ) then raise invalid_parameter_value using message='Follow the Sky astronomy anchors cannot be moved or shortened'; end if;
      if v_flow.id is not null then
        if v_action?'expected_flow_revision' and (v_action->>'expected_flow_revision')::bigint is distinct from v_flow.assistance_revision then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind','flow_contract','row',to_jsonb(v_flow))); end if;
        if v_shortens and not(v_action?'expected_flow_revision') then raise invalid_parameter_value using message='Shortening needs the authored revision'; end if;
        if v_shortens or (v_patch?'behavior_payload' and (v_after#>'{behavior_payload,ask_haw}') is distinct from (v_event.behavior_payload->'ask_haw')) then
          perform private.ask_haw_validate_step(v_flow.assistance,v_after->'behavior_payload',(v_after->>'starts_at')::timestamptz,(v_after->>'ends_at')::timestamptz,v_shortens);
        end if;
      elsif v_patch?'behavior_payload' and v_patch->'behavior_payload'?'ask_haw' then raise invalid_parameter_value using message='Authored metadata needs a source Flow'; end if;
      v_proposals:=v_proposals||jsonb_build_array(v_after||jsonb_build_object('avoid_conflicts',coalesce((v_action->>'avoid_conflicts')::boolean,false)));

    elsif v_kind='event_create' then
      v_cid:=nullif(btrim(v_action->>'client_event_id'),''); v_calendar:=(v_action->>'calendar_id')::uuid; v_patch:=v_action->'event';
      if v_cid is null or length(v_cid)>255 or v_calendar is null or not private.ask_haw_can_edit_calendar(p_account,v_calendar) then raise insufficient_privilege using message='Calendar not editable'; end if;
      if v_patch is null or jsonb_typeof(v_patch)<>'object' or exists(select 1 from jsonb_object_keys(v_patch) k where k not in('title','detail','location','all_day','starts_at','ends_at','flow_local_id','category','action_id','behavior_payload')) then raise invalid_parameter_value using message='Invalid event create'; end if;
      if lower(coalesce(v_patch->>'category',''))='tombstone' then raise invalid_parameter_value using message='Invalid event category'; end if;
      if v_patch->>'flow_local_id' is not null and not exists(select 1 from public.flows f where f.id=(v_patch->>'flow_local_id')::bigint and f.calendar_id=v_calendar and not public.flow_is_deleted_state(f.active,f.is_hidden,f.notes)) then raise insufficient_privilege using message='Flow not editable'; end if;
      if v_patch->>'flow_local_id' is not null then
        select * into v_flow from public.flows where id=(v_patch->>'flow_local_id')::bigint for update;
        perform private.ask_haw_validate_step(v_flow.assistance,v_patch->'behavior_payload',(v_patch->>'starts_at')::timestamptz,(v_patch->>'ends_at')::timestamptz,false);
        if not v_flow.active or v_flow.paused_at is not null or (v_flow.end_date is not null and ((v_patch->>'starts_at')::timestamptz at time zone coalesce(nullif(public._get_user_timezone(p_account),''),'UTC'))::date>v_flow.end_date) or (v_action?'expected_flow_revision' and (v_action->>'expected_flow_revision')::bigint is distinct from v_flow.assistance_revision) then
          v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind','flow_contract','row',to_jsonb(v_flow)));
        end if;
      end if;
      if v_patch->'behavior_payload'?'ask_haw' and (v_patch->>'flow_local_id' is null or not(v_action?'expected_flow_revision')) then raise invalid_parameter_value using message='Authored event needs its source revision'; end if;
      v_step:=nullif(v_patch#>>'{behavior_payload,ask_haw,step_id}','');
      if v_step is not null and v_flow.id is not null then
        v_source_timezone:=coalesce(nullif(public._get_user_timezone(v_flow.user_id),''),'UTC');
        v_period:='day:'||to_char((v_patch->>'starts_at')::timestamptz at time zone v_source_timezone,'YYYY-MM-DD');
        v_recurring:=case when jsonb_typeof(v_flow.rules)='array' then exists(select 1 from jsonb_array_elements(v_flow.rules) r where r->>'type' in('week','decan','dates')) else false end;
        v_reservation:=v_flow.id::text||':'||v_step||':'||case when v_recurring then v_period else 'active' end;
        if v_reservation=any(v_reservations) then
          v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind','duplicate_flow_step','row',null));
        end if;
        v_reservations:=array_append(v_reservations,v_reservation);
        -- The source Flow FOR UPDATE lock serializes devices and accepted
        -- editors even when each uses a different proposal/mutation UUID.
        select raw.* into v_busy from public.user_events raw join public.user_event_filing_items_client e on e.id=raw.id
          where e.calendar_id=v_flow.calendar_id and e.filed_flow_id=v_flow.id
            and raw.behavior_payload#>>'{ask_haw,step_id}'=v_step
            and (coalesce(raw.ask_haw_period_key,'day:'||to_char(raw.starts_at at time zone v_source_timezone,'YYYY-MM-DD'))=v_period
              or (not v_recurring and not raw.flow_suspended and ((not raw.all_day and raw.ends_at is null) or private.ask_haw_event_end(raw.starts_at,raw.ends_at,raw.all_day,v_source_timezone)>now())
                and not exists(select 1 from public.user_event_completions c where c.user_id=raw.user_id and c.client_event_id=raw.client_event_id
                  and coalesce(nullif(c.metadata->>'completion_status',''),'observed') in('observed','skipped','done','completed'))))
          order by raw.starts_at,raw.id limit 1;
        if found then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind','duplicate_flow_step','row',to_jsonb(v_busy))); end if;
      end if;
      v_proposals:=v_proposals||jsonb_build_array(v_patch||jsonb_build_object('client_event_id',v_cid,'calendar_id',v_calendar,'user_id',p_account,'avoid_conflicts',coalesce((v_action->>'avoid_conflicts')::boolean,false)));
      select * into v_event from public.user_events where client_event_id=v_cid for update;
      if found then
        if v_event.user_id<>p_account then raise insufficient_privilege using message='Event identity unavailable'; end if;
        v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind',v_kind,'row',to_jsonb(v_event)));
      end if;
    else
      select * into v_flow from public.flows where id=(v_action->>'id')::bigint for update;
      if not found or not private.ask_haw_can_edit_calendar(p_account,v_flow.calendar_id) then raise insufficient_privilege using message='Flow not editable'; end if;
      if public.flow_is_deleted_state(v_flow.active,v_flow.is_hidden,v_flow.notes) then raise invalid_parameter_value using message='Deleted Flow is not editable'; end if;
      if (v_action->>'expected_revision')::bigint is distinct from v_flow.assistance_revision then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind',v_kind,'row',to_jsonb(v_flow))); end if;
      if v_kind='flow_assistance' and (not(v_action?'assistance') or (v_action->'assistance'<>'null'::jsonb and jsonb_typeof(v_action->'assistance')<>'object')) then raise invalid_parameter_value using message='Invalid assistance contract'; end if;
    end if;
  end loop;
  -- Compare the final proposed positions with visible persisted commitments
  -- and with one another. Moving two events is judged on its final state.
  for v_proposal in select value from jsonb_array_elements(v_proposals) where coalesce((value->>'avoid_conflicts')::boolean,false) loop
    v_start:=(v_proposal->>'starts_at')::timestamptz;
    v_end:=private.ask_haw_event_end(v_start,(v_proposal->>'ends_at')::timestamptz,(v_proposal->>'all_day')::boolean,v_timezone);
    if v_start is null or nullif(btrim(v_proposal->>'title'),'') is null or (v_proposal->>'ends_at')::timestamptz<v_start then raise invalid_parameter_value using message='Invalid event timing or title'; end if;
    select raw.* into v_busy from public.user_events raw join public.user_event_filing_items_client e on e.id=raw.id join public.shared_calendars c on c.id=e.calendar_id and c.deleted_at is null
      where not raw.flow_suspended and lower(coalesce(e.category,''))<>'tombstone'
        and (e.user_id=p_account or exists(select 1 from public.shared_calendar_members m where m.calendar_id=e.calendar_id and m.user_id=p_account and m.status='accepted')
          or exists(select 1 from public.event_shares es where es.event_id=e.id and (es.recipient_id=p_account or es.sender_id=p_account)))
        and not exists(select 1 from jsonb_array_elements(p_actions) a where a->>'kind'='event_patch' and (a->>'id')::uuid=e.id)
        and e.starts_at<v_end and ((not e.all_day and e.ends_at is null) or private.ask_haw_event_end(e.starts_at,e.ends_at,e.all_day,coalesce(nullif(public._get_user_timezone(e.user_id),''),'UTC'))>v_start)
      order by e.starts_at,e.id limit 1;
    if found then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind','schedule_conflict','row',to_jsonb(v_busy))); end if;
    if exists(select 1 from public.external_calendar_events_v1 e where e.user_id=p_account and e.starts_at<v_end and e.ends_at>v_start) then
      v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind','external_schedule_conflict','row',null));
    end if;
    for v_other in select value from jsonb_array_elements(v_proposals) loop
      if v_other=v_proposal then continue; end if;
      if (v_other->>'starts_at')::timestamptz<v_end and private.ask_haw_event_end((v_other->>'starts_at')::timestamptz,(v_other->>'ends_at')::timestamptz,(v_other->>'all_day')::boolean,v_timezone)>v_start then
        v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('kind','proposed_schedule_conflict','row',v_other));
      end if;
    end loop;
  end loop;
  if jsonb_array_length(v_conflicts)>0 then v_result:=jsonb_build_object('status','conflict','rows',v_conflicts,'mutation_id',p_mutation);
  else
    for v_action in select value from jsonb_array_elements(p_actions) loop
      v_kind:=v_action->>'kind';
      if v_kind='event_patch' then
        select * into v_event from public.user_events where id=(v_action->>'id')::uuid;
        v_patch:=v_action->'patch'; v_after:=to_jsonb(v_event)||v_patch;
        update public.user_events e set title=r.title,detail=r.detail,location=r.location,all_day=r.all_day,starts_at=r.starts_at,ends_at=r.ends_at,behavior_payload=r.behavior_payload
          from jsonb_populate_record(null::public.user_events,v_after) r where e.id=v_event.id returning to_jsonb(e) into v_after;
        -- Preserve each existing alert's delta and identity. No alert is created
        -- or re-enabled by a move; delivered/disabled alerts stay disabled.
        update public.scheduled_notifications n set
          scheduled_at=n.scheduled_at+case when n.notification_type='event_end' then coalesce((v_after->>'ends_at')::timestamptz,(v_after->>'starts_at')::timestamptz)-coalesce(v_event.ends_at,v_event.starts_at) else (v_after->>'starts_at')::timestamptz-v_event.starts_at end,
          claimed_at=null,claim_token=null,attempt_count=0,last_error=null,last_attempt_at=null,
          no_token_attempt_count=0,no_token_first_at=null,next_attempt_at=null,expires_at=null,token_available_at=null
          where n.client_event_id=v_event.client_event_id and (n.is_active or n.flow_pause_suppressed)
            and (v_event.starts_at is distinct from (v_after->>'starts_at')::timestamptz or v_event.ends_at is distinct from (v_after->>'ends_at')::timestamptz);

      elsif v_kind='event_create' then
        v_patch:=v_action->'event';
        insert into public.user_events(user_id,client_event_id,calendar_id,title,detail,location,all_day,starts_at,ends_at,flow_local_id,category,action_id,behavior_payload)
        values(p_account,v_action->>'client_event_id',(v_action->>'calendar_id')::uuid,v_patch->>'title',v_patch->>'detail',v_patch->>'location',coalesce((v_patch->>'all_day')::boolean,false),
          (v_patch->>'starts_at')::timestamptz,(v_patch->>'ends_at')::timestamptz,(v_patch->>'flow_local_id')::integer,v_patch->>'category',v_patch->>'action_id',v_patch->'behavior_payload') returning to_jsonb(user_events) into v_after;
      else
        update public.flows f set paused_at=case when v_kind='flow_pause' then coalesce(f.paused_at,now()) when v_kind='flow_resume' then null else f.paused_at end,
          assistance=case when v_kind='flow_assistance' then nullif(v_action->'assistance','null'::jsonb) else f.assistance end
          where id=(v_action->>'id')::bigint returning to_jsonb(f) into v_after;
      end if;
      if v_kind like 'event_%' and (nullif(btrim(v_after->>'title'),'') is null or (v_after->>'starts_at') is null or ((v_after->>'ends_at')::timestamptz<(v_after->>'starts_at')::timestamptz)) then raise invalid_parameter_value using message='Invalid event timing or title'; end if;
      v_rows:=v_rows||jsonb_build_array(jsonb_build_object('kind',v_kind,'row',v_after));
    end loop;
    v_result:=jsonb_build_object('status','applied','rows',v_rows,'mutation_id',p_mutation);
  end if;
  insert into private.ask_haw_mutation_receipts(user_id,mutation_id,domain,request,result) values(p_account,p_mutation,'actions',p_actions,v_result);
  return v_result;
end $$;
create function public.apply_ask_haw_actions_v1(p_account uuid,p_mutation uuid,p_actions jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.apply_ask_haw_actions(p_account,p_mutation,p_actions) $$;

-- Preserve the established filing row type and immutable old-release fixtures.
-- Live rows reuse that owner, with only a future-pause visibility overlay.
-- The context RPC below joins optional source metadata after classification.
do $migration$
declare v_definition text; v_columns text;
begin
  select string_agg(case when a.attname='live_on_calendar' then '(p.live_on_calendar and (not s.flow_suspended or s.starts_at<now())) as live_on_calendar' else format('p.%I',a.attname) end,',' order by a.attnum) into v_columns
    from pg_attribute a where a.attrelid='public.user_event_filing_items_client'::regclass and a.attnum>0 and not a.attisdropped;
  v_definition:=regexp_replace(pg_get_viewdef('public.user_event_filing_items_client'::regclass,true),';\s*$','');
  execute 'create or replace view public.user_event_filing_items_client with(security_invoker=true) as with ask_haw_existing_projection as ('
    ||v_definition||') select '||v_columns||' from ask_haw_existing_projection p join public.user_events s on s.id=p.id';
end $migration$;

create function public.read_ask_haw_context_v1(p_account uuid,p_from timestamptz,p_until timestamptz) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_events jsonb; v_flows jsonb; v_calendar uuid; v_coverage jsonb; v_timezone text; v_completions jsonb;
begin
  if auth.uid() is null or p_account is distinct from auth.uid() then raise insufficient_privilege using message='Not authenticated'; end if;
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>interval '31 days' then raise invalid_parameter_value using message='Invalid context window'; end if;
  v_timezone:=coalesce(nullif(public._get_user_timezone(p_account),''),'UTC');
  v_coverage:=jsonb_build_object('from',p_from,'until',p_until,'complete',true);
  select c.id into v_calendar from public.shared_calendars c join public.shared_calendar_members m on m.calendar_id=c.id
    where c.owner_id=p_account and c.is_personal and c.deleted_at is null and m.user_id=p_account and m.status='accepted'
    order by c.created_at,c.id limit 1;
  select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('can_edit',private.ask_haw_can_edit_calendar(p_account,e.calendar_id),'completion_status',coalesce((select coalesce(nullif(c.metadata->>'completion_status',''),'observed') from public.user_event_completions c where c.user_id=p_account and c.client_event_id=e.client_event_id order by c.completed_at desc,c.id desc limit 1),'unknown')) order by e.starts_at,e.id),'[]'::jsonb) into v_events
    from (select e.*,r.event_revision,r.flow_suspended,r.ask_haw_period_key from public.user_event_filing_items_client e join public.user_events r on r.id=e.id where e.starts_at<p_until and
      ((not e.all_day and e.ends_at is null) or coalesce(e.ends_at,case when e.all_day then ((e.starts_at at time zone public._get_user_timezone(e.user_id))::date+1)::timestamp at time zone public._get_user_timezone(e.user_id) else e.starts_at+interval '1 microsecond' end)>p_from)
      order by e.starts_at,e.id limit 5001) e;
  select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('can_edit',private.ask_haw_can_edit_calendar(p_account,f.calendar_id)) order by f.id),'[]'::jsonb) into v_flows
    from (select f.* from public.flows f join public.shared_calendar_members m on m.calendar_id=f.calendar_id and m.user_id=p_account and m.status='accepted'
      where not public.flow_is_deleted_state(f.active,f.is_hidden,f.notes) order by f.id limit 1001) f;
  with completion_rows as (
    select c.flow_id,coalesce(nullif(c.metadata->>'assistance_step_id',''),nullif(e.behavior_payload#>>'{ask_haw,step_id}','')) as step_id,
      case when coalesce(nullif(c.metadata->>'completion_status',''),'observed')='observed' and e.behavior_payload#>>'{ask_haw,counts_as_completion}'='false' then 'unknown' else coalesce(nullif(c.metadata->>'completion_status',''),'observed') end as status,c.completed_at,c.id
    from public.user_event_completions c left join public.user_events e on e.user_id=c.user_id and e.client_event_id=c.client_event_id
    where c.user_id=p_account and c.flow_id in(select (f->>'id')::bigint from jsonb_array_elements(v_flows) f)
    order by c.completed_at desc,c.id desc limit 10001
  ), latest as (
    select distinct on(flow_id,step_id) flow_id,step_id,status from completion_rows where step_id is not null order by flow_id,step_id,completed_at desc,id desc
  ), per_flow as (select flow_id,jsonb_object_agg(step_id,status) as steps from latest group by flow_id)
  select jsonb_build_object('map',coalesce((select jsonb_object_agg(flow_id::text,steps) from per_flow),'{}'::jsonb),'count',(select count(*) from completion_rows)) into v_completions;
  if (v_completions->>'count')::int>10000 or jsonb_array_length(v_events)>5000 or jsonb_array_length(v_flows)>1000 then return jsonb_build_object('status','incomplete','coverage',v_coverage||'{"complete":false}'::jsonb,'events','[]'::jsonb,'flows','[]'::jsonb,'personal_calendar_id',v_calendar,'timezone',v_timezone,'step_completions',case when (v_completions->>'count')::int>10000 then '{}'::jsonb else v_completions->'map' end); end if;
  return jsonb_build_object('status','ready','coverage',v_coverage,'events',v_events,'flows',v_flows,'personal_calendar_id',v_calendar,'timezone',v_timezone,'step_completions',case when (v_completions->>'count')::int>10000 then '{}'::jsonb else v_completions->'map' end);
end $$;

-- Keep existing source/share/import owners and add only the authored contract.
do $migration$
declare v_definition text; v_changed text;
begin
  v_definition:=pg_get_functiondef('public.event_share_source_flow_payload(uuid)'::regprocedure);
  v_changed:=replace(v_definition,'''rules'', coalesce(source_flow.rules, ''[]''::jsonb),','''rules'', coalesce(source_flow.rules, ''[]''::jsonb),'||chr(10)||'    ''assistance'', source_flow.assistance,');
  if v_changed=v_definition then raise exception 'Unrecognized event-share source contract'; end if;
  execute v_changed;
  v_definition:=pg_get_functiondef('public.sync_event_share_calendar_copy_from_row(public.event_shares)'::regprocedure);
  v_changed:=replace(v_definition,'source_flow_rules jsonb := ''[]''::jsonb;','source_flow_rules jsonb := ''[]''::jsonb;'||chr(10)||'  source_flow_assistance jsonb;');
  v_changed:=replace(v_changed,'source_flow_rules := case','source_flow_assistance := case when jsonb_typeof(source_flow->''assistance'')=''object'' then source_flow->''assistance'' else null end;'||chr(10)||'    source_flow_rules := case');
  v_changed:=replace(v_changed,'        rules,','        rules,'||chr(10)||'        assistance,');
  v_changed:=replace(v_changed,'        source_flow_rules,','        source_flow_rules,'||chr(10)||'        source_flow_assistance,');
  if v_changed=v_definition or position('        source_flow_assistance,' in v_changed)=0 then raise exception 'Unrecognized event-share import contract'; end if;
  -- A recipient copy owns its optional contract after creation, even when
  -- explicitly cleared. Existing source name/rule/event sync is unchanged.
  execute v_changed;
end $migration$;

-- Live hydration stays with the current owner; full raw detail reads retain
-- suspended occurrences. A resumed Flow never delivers elapsed paused alerts.
do $migration$
declare v_signature text; v_definition text; v_changed text;
begin
  foreach v_signature in array array['public.get_calendar_flow_events_v2(timestamp with time zone,timestamp with time zone,bigint[],integer,integer)','public.get_calendar_standalone_events_v2(timestamp with time zone,timestamp with time zone,integer,integer)'] loop
    v_definition:=pg_get_functiondef(v_signature::regprocedure);
    v_changed:=replace(v_definition,'on ue.id = ci.id','on ue.id = ci.id and (not ue.flow_suspended or ue.starts_at < now())');
    if v_changed=v_definition then raise exception 'Unrecognized calendar hydration owner: %',v_signature; end if;
    execute v_changed;
  end loop;
  v_definition:=pg_get_functiondef('public.claim_due_scheduled_notifications(timestamp with time zone,integer,integer)'::regprocedure);
  v_changed:=replace(v_definition,'where sn.is_active = true','where sn.is_active = true and not sn.flow_pause_suppressed'||chr(10)||'      and not exists(select 1 from public.user_events e where e.client_event_id=sn.client_event_id and e.flow_suspended)');
  if v_changed=v_definition then raise exception 'Unrecognized notification claim owner'; end if;
  execute v_changed;
end $migration$;

revoke all on function private.ask_haw_flow_revision(),private.ask_haw_event_revision(),private.ask_haw_apply_pause(),private.ask_haw_notification_pause() from public,anon,authenticated;
revoke all on function private.ask_haw_can_edit_calendar(uuid,uuid) from public,anon;
grant execute on function private.ask_haw_can_edit_calendar(uuid,uuid) to authenticated;
revoke all on function private.read_ask_haw_memory(uuid),private.apply_ask_haw_memory(uuid,uuid,bigint,bigint,text,jsonb),private.apply_ask_haw_actions(uuid,uuid,jsonb) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.read_ask_haw_memory(uuid),private.apply_ask_haw_memory(uuid,uuid,bigint,bigint,text,jsonb),private.apply_ask_haw_actions(uuid,uuid,jsonb) to authenticated;
revoke all on function public.read_ask_haw_memory_v1(uuid),public.apply_ask_haw_memory_v1(uuid,uuid,bigint,bigint,text,jsonb),public.apply_ask_haw_actions_v1(uuid,uuid,jsonb),public.read_ask_haw_context_v1(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.read_ask_haw_memory_v1(uuid),public.apply_ask_haw_memory_v1(uuid,uuid,bigint,bigint,text,jsonb),public.apply_ask_haw_actions_v1(uuid,uuid,jsonb),public.read_ask_haw_context_v1(uuid,timestamptz,timestamptz) to authenticated;
-- Query the published catalog itself; LIMIT bounds results after matching,
-- never the search corpus. Existing post RLS, discoverability and reverse-block
-- predicate remain the visibility authority.
create index flow_posts_ask_haw_search_idx on public.flow_posts using gin (
  to_tsvector('english',coalesce(name,'')||' '||coalesce(notes,'')||' '||coalesce(ai_metadata->>'shared_note','')||' '||coalesce(ai_metadata->>'caption',''))
);
create function public.search_ask_haw_flows_v1(p_account uuid,p_query text,p_limit integer default 10) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_query tsquery; v_rows jsonb; v_limit integer:=least(greatest(coalesce(p_limit,10),1),20);
begin
  if auth.uid() is null or p_account is distinct from auth.uid() then raise insufficient_privilege using message='Not authenticated'; end if;
  if p_query is null or length(btrim(p_query)) not between 2 and 160 then raise invalid_parameter_value using message='Invalid search'; end if;
  v_query:=plainto_tsquery('english',p_query);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'name',s.name,'color',s.color,'notes',s.notes,'rules',s.rules,
    'start_date',s.start_date,'end_date',s.end_date,'created_at',s.created_at,'payload',s.ai_metadata->'payload',
    'source_flow_id',case when s.user_id=p_account then s.flow_id else null end) order by s.rank desc,s.created_at desc,s.id),'[]'::jsonb) into v_rows
  from (select fp.*,ts_rank(to_tsvector('english',coalesce(fp.name,'')||' '||coalesce(fp.notes,'')||' '||coalesce(fp.ai_metadata->>'shared_note','')||' '||coalesce(fp.ai_metadata->>'caption','')),v_query) as rank
    from public.flow_posts fp join public.profiles p on p.id=fp.user_id
    where not coalesce(fp.is_hidden,false) and coalesce(p.is_discoverable,true)
      and private.can_view_decan_post(fp.user_id)
      and to_tsvector('english',coalesce(fp.name,'')||' '||coalesce(fp.notes,'')||' '||coalesce(fp.ai_metadata->>'shared_note','')||' '||coalesce(fp.ai_metadata->>'caption',''))@@v_query
    order by rank desc,fp.created_at desc,fp.id limit v_limit+1) s;
  return jsonb_build_object('status','ready','complete',true,'has_more',jsonb_array_length(v_rows)>v_limit,
    'results',case when jsonb_array_length(v_rows)>v_limit then v_rows-v_limit else v_rows end);
end $$;
revoke all on function public.search_ask_haw_flows_v1(uuid,text,integer) from public,anon;
grant execute on function public.search_ask_haw_flows_v1(uuid,text,integer) to authenticated;

notify pgrst,'reload schema';
commit;
