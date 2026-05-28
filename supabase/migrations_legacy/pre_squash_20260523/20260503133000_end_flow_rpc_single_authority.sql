create or replace function public.user_event_completions_validate_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = new.flow_id
     and f.user_id = new.user_id
    where ue.user_id = new.user_id
      and ue.client_event_id = new.client_event_id
      and public.user_event_matches_flow(
        new.flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
  ) then
    raise exception
      'user_event_completions: no matching user_events row for (user_id, client_event_id, flow_id)';
  end if;

  return new;
end;
$$;

create or replace function public.record_event_completion(
  p_client_event_id text,
  p_flow_id bigint,
  p_completed_on date,
  p_source text default 'client'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_client_event_id is null or btrim(p_client_event_id) = '' then
    raise exception 'client_event_id required';
  end if;

  if p_flow_id is null then
    raise exception 'flow_id required';
  end if;

  if p_completed_on is null then
    raise exception 'completed_on required';
  end if;

  if not exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = p_flow_id
     and f.user_id = v_uid
    where ue.user_id = v_uid
      and ue.client_event_id = p_client_event_id
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
  ) then
    raise exception 'event not found or not owned';
  end if;

  insert into public.user_event_completions (
    user_id,
    client_event_id,
    flow_id,
    completed_on,
    completed_at,
    source
  )
  values (
    v_uid,
    p_client_event_id,
    p_flow_id,
    p_completed_on,
    now(),
    coalesce(p_source, 'client')
  )
  on conflict (user_id, client_event_id) do update
    set completed_on = excluded.completed_on,
        completed_at = excluded.completed_at,
        source = excluded.source;
end;
$$;

comment on function public.record_event_completion(text, bigint, date, text) is
'Validates ownership using the canonical flow-event matcher and upserts a completion keyed by client_event_id + completed_on.';

revoke all on function public.record_event_completion(text, bigint, date, text) from public;
grant execute on function public.record_event_completion(text, bigint, date, text) to authenticated;

create or replace function public.end_flow(
  p_flow_id bigint,
  p_ended_at timestamptz default timezone('utc', now()),
  p_ended_on date default null
)
returns table (
  flow_id bigint,
  ended_at timestamptz,
  ended_on date,
  deleted_event_count integer,
  retired_notification_count integer,
  deleted_completion_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_flow_active boolean;
  v_flow_is_hidden boolean;
  v_flow_notes text;
  v_ended_at timestamptz := coalesce(p_ended_at, timezone('utc', now()));
  v_ended_on date;
  v_deleted_event_count integer := 0;
  v_retired_notification_count integer := 0;
  v_deleted_completion_count integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(p_flow_id, 0) <= 0 then
    raise exception 'flow_id required';
  end if;

  v_ended_on := coalesce(
    p_ended_on,
    (v_ended_at at time zone public._get_user_timezone(v_uid))::date
  );

  select f.active, f.is_hidden, f.notes
    into v_flow_active, v_flow_is_hidden, v_flow_notes
  from public.flows f
  where f.id = p_flow_id
    and f.user_id = v_uid
  for update;

  if not found then
    raise exception 'flow not found or not owned';
  end if;

  if public.flow_is_deleted_state(
    v_flow_active,
    v_flow_is_hidden,
    v_flow_notes
  ) then
    raise exception 'flow already deleted';
  end if;

  with updated_flow as (
    update public.flows f
       set active = false,
           end_date = case
             when f.end_date is null or f.end_date > v_ended_on then v_ended_on
             else f.end_date
           end
     where f.id = p_flow_id
       and f.user_id = v_uid
     returning f.id, f.ai_metadata
  ),
  deleted_events as (
    delete from public.user_events ue
    using updated_flow uf
    where ue.user_id = v_uid
      and lower(coalesce(ue.category, '')) <> 'tombstone'
      and ue.starts_at >= v_ended_at
      and public.user_event_matches_flow(
        uf.id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        uf.ai_metadata
      )
    returning ue.client_event_id
  ),
  retired_notifications as (
    update public.scheduled_notifications sn
       set is_active = false
      where sn.user_id = v_uid
        and sn.is_active = true
        and exists (
          select 1
          from deleted_events de
          where de.client_event_id is not null
            and de.client_event_id = sn.client_event_id
        )
    returning sn.client_event_id
  ),
  deleted_completions as (
    delete from public.user_event_completions uec
    where uec.user_id = v_uid
      and exists (
        select 1
        from deleted_events de
        where de.client_event_id is not null
          and de.client_event_id = uec.client_event_id
      )
    returning uec.client_event_id
  )
  select
    coalesce((select count(*) from deleted_events), 0)::integer,
    coalesce((select count(*) from retired_notifications), 0)::integer,
    coalesce((select count(*) from deleted_completions), 0)::integer
    into
      v_deleted_event_count,
      v_retired_notification_count,
      v_deleted_completion_count;

  return query
  select
    p_flow_id,
    v_ended_at,
    v_ended_on,
    v_deleted_event_count,
    v_retired_notification_count,
    v_deleted_completion_count;
end;
$$;

comment on function public.end_flow(bigint, timestamptz, date) is
'Canonical end-flow lifecycle RPC. Ends the flow, prunes future materialized companion rows from one cutoff, retires scheduled notifications, and removes completions for deleted events in a single transaction.';

revoke all on function public.end_flow(bigint, timestamptz, date) from public;
grant execute on function public.end_flow(bigint, timestamptz, date) to authenticated;

drop trigger if exists trg_purge_ended_flow_future_events on public.flows;
drop function if exists public.purge_ended_flow_future_events();

notify pgrst, 'reload schema';
