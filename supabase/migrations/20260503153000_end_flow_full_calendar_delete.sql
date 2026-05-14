drop function if exists public.end_flow(bigint, timestamptz, date, boolean);
drop function if exists public.end_flow(bigint, timestamptz, date);

create or replace function public.end_flow(
  p_flow_id bigint,
  p_ended_at timestamptz default timezone('utc', now()),
  p_ended_on date default null,
  p_delete_all_materialized boolean default false
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
  v_flow_user_id uuid;
  v_flow_calendar_id uuid;
  v_flow_reminder_uuid uuid;
  v_flow_active boolean;
  v_flow_is_hidden boolean;
  v_flow_notes text;
  v_flow_ai_metadata jsonb;
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

  select
    f.user_id,
    f.calendar_id,
    f.reminder_uuid,
    f.active,
    f.is_hidden,
    f.notes,
    f.ai_metadata
    into
      v_flow_user_id,
      v_flow_calendar_id,
      v_flow_reminder_uuid,
      v_flow_active,
      v_flow_is_hidden,
      v_flow_notes,
      v_flow_ai_metadata
  from public.flows f
  where f.id = p_flow_id
    and (
      f.user_id = v_uid
      or exists (
        select 1
        from public.shared_calendar_members scm
        join public.shared_calendars sc
          on sc.id = scm.calendar_id
        where scm.calendar_id = f.calendar_id
          and scm.user_id = v_uid
          and scm.status = 'accepted'
          and scm.role in ('owner', 'editor')
          and sc.deleted_at is null
      )
    )
  for update;

  if not found then
    raise exception 'flow not found or insufficient calendar role';
  end if;

  if public.flow_is_deleted_state(
    v_flow_active,
    v_flow_is_hidden,
    v_flow_notes
  ) then
    raise exception 'flow already deleted';
  end if;

  update public.flows f
     set active = false,
         end_date = case
           when f.end_date is null or f.end_date > v_ended_on then v_ended_on
           else f.end_date
         end
   where f.id = p_flow_id;

  with deleted_events as (
    delete from public.user_events ue
    where lower(coalesce(ue.category, '')) <> 'tombstone'
      and (
        p_delete_all_materialized
        or ue.starts_at >= v_ended_at
      )
      and coalesce(ue.calendar_id, v_flow_calendar_id) = v_flow_calendar_id
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        v_flow_ai_metadata
      )
    returning ue.id, ue.user_id, ue.client_event_id
  ),
  retired_notifications as (
    update public.scheduled_notifications sn
       set is_active = false
      where sn.is_active = true
        and exists (
          select 1
          from deleted_events de
          where de.user_id = sn.user_id
            and de.client_event_id is not null
            and de.client_event_id = sn.client_event_id
        )
    returning sn.id
  ),
  deleted_completions as (
    delete from public.user_event_completions uec
    where exists (
      select 1
      from deleted_events de
      where de.user_id = uec.user_id
        and de.client_event_id is not null
        and de.client_event_id = uec.client_event_id
    )
    returning uec.user_id, uec.client_event_id
  ),
  retired_reminders as (
    update public.reminders r
       set status = 'completed',
           updated_at = now()
      where r.status <> 'completed'
        and (
          (v_flow_reminder_uuid is not null and r.id = v_flow_reminder_uuid)
          or exists (
            select 1
            from deleted_events de
            where r.event_id = de.id
               or r.flow_event_id = de.id
          )
        )
    returning r.id
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

comment on function public.end_flow(bigint, timestamptz, date, boolean) is
'Canonical end-flow lifecycle RPC. Owners and accepted shared-calendar owners/editors may end a flow; when p_delete_all_materialized is false the RPC prunes future materialized rows from the cutoff, and when true it removes every matched materialized row from that flow calendar while leaving already shared, posted, or saved copies in their own records unchanged. Notifications, reminders, and completions linked to deleted rows are retired in the same transaction.';

revoke all on function public.end_flow(bigint, timestamptz, date, boolean) from public;
grant execute on function public.end_flow(bigint, timestamptz, date, boolean) to authenticated;

notify pgrst, 'reload schema';
