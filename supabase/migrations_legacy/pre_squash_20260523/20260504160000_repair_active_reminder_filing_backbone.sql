create or replace function public.try_parse_jsonb(
  p_raw text
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_raw is null or btrim(p_raw) = '' then
    return null;
  end if;

  return p_raw::jsonb;
exception
  when others then
    return null;
end;
$$;

revoke all on function public.try_parse_jsonb(text) from public;
grant execute on function public.try_parse_jsonb(text) to service_role;

create or replace function public.user_event_has_active_reminder_flow(
  p_user_id uuid,
  p_reminder_uuid uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and p_reminder_uuid is not null
    and exists (
      select 1
      from public.flows f
      where f.user_id = p_user_id
        and f.reminder_uuid = p_reminder_uuid
        and f.is_reminder = true
        and f.active = true
        and coalesce(f.is_hidden, false) = false
        and public.flow_is_deleted_state(
          f.active,
          coalesce(f.is_hidden, false),
          f.notes
        ) = false
    )
$$;

revoke all on function public.user_event_has_active_reminder_flow(uuid, uuid) from public;
grant execute on function public.user_event_has_active_reminder_flow(uuid, uuid) to service_role;

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
          and edt.client_event_id = tombstone_keys.client_event_id
      ) as has_exact_tombstone,
      exists (
        select 1
        from public.event_deletion_trash edt
        where edt.user_id = p_user_id
          and edt.purged_at is null
          and edt.purge_after > timezone('utc', now())
          and tombstone_keys.reminder_uuid is not null
          and edt.client_event_id in (
            tombstone_keys.reminder_series_key,
            tombstone_keys.reminder_rule_key
          )
      ) as has_series_tombstone,
      public.user_event_has_active_reminder_flow(
        p_user_id,
        tombstone_keys.reminder_uuid
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

comment on function public.user_event_recently_deleted(uuid, text) is
'Returns true when an event has an active tombstone. Reminder orphan cleanup now treats an active, visible reminder flow as the durable rule source; scheduled_notifications are delivery state only.';

create or replace function public.purge_old_event_deletion_trash()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  -- If an old trash marker survived while the raw event row also survived,
  -- remove the raw row before removing the hidden trash marker. The delete
  -- trigger will archive that raw row again, keeping client-safe suppression
  -- intact for another retention window instead of allowing a ghost to refile.
  delete from public.user_events ue
  using public.event_deletion_trash edt
  where edt.purge_after <= timezone('utc', now())
    and edt.purged_at is null
    and ue.user_id = edt.user_id
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

create or replace function public.reconcile_event_filing_backbone(
  p_limit integer default 50000
)
returns table (
  orphan_reminder_events_deleted integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 50000), 1);
begin
  with candidates as (
    select ue.id
    from public.user_events ue
    where public.user_event_reminder_uuid(ue.client_event_id) is not null
      and public.user_event_has_active_reminder_flow(
        ue.user_id,
        public.user_event_reminder_uuid(ue.client_event_id)
      ) = false
      and not exists (
        select 1
        from public.reminders r
        where r.user_id = ue.user_id
          and r.id = public.user_event_reminder_uuid(ue.client_event_id)
      )
      and not exists (
        select 1
        from public.scheduled_notifications sn
        where sn.user_id = ue.user_id
          and sn.is_active = true
          and sn.client_event_id = ue.client_event_id
      )
    order by ue.created_at nulls last, ue.id
    limit v_limit
  ),
  deleted as (
    delete from public.user_events ue
    using candidates c
    where ue.id = c.id
    returning 1
  )
  select count(*)::integer
  into orphan_reminder_events_deleted
  from deleted;

  return next;
end;
$$;

revoke all on function public.reconcile_event_filing_backbone(integer) from public;
grant execute on function public.reconcile_event_filing_backbone(integer) to service_role;

comment on function public.reconcile_event_filing_backbone(integer) is
'Repeatable filing reconciliation job. Removes orphan materialized reminder events only when no active reminder flow, legacy reminder row, or active notification can justify them.';

create or replace function public.repair_active_reminder_filing_backbone()
returns table (
  reminder_event_rows_restored integer,
  reminder_notifications_reactivated integer,
  reminder_occurrence_tombstones_removed integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restored integer := 0;
  v_reactivated integer := 0;
  v_tombstones_removed integer := 0;
begin
  drop table if exists pg_temp.reminder_restore_candidates;

  create temporary table reminder_restore_candidates (
    user_id uuid not null,
    client_event_id text not null,
    title text not null,
    detail text,
    location text,
    all_day boolean not null,
    starts_at timestamp with time zone not null,
    ends_at timestamp with time zone,
    flow_local_id integer not null,
    calendar_id uuid not null,
    category text,
    source_priority integer not null
  ) on commit drop;

  insert into reminder_restore_candidates (
    user_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    calendar_id,
    category,
    source_priority
  )
  with flow_rules as (
    select
      f.*,
      public.try_parse_jsonb(f.notes) as rule_json,
      coalesce(nullif(p.timezone, ''), 'America/Los_Angeles') as profile_timezone
    from public.flows f
    left join public.profiles p
      on p.id = f.user_id
    where f.is_reminder = true
      and f.active = true
      and coalesce(f.is_hidden, false) = false
      and f.reminder_uuid is not null
      and public.flow_is_deleted_state(
        f.active,
        coalesce(f.is_hidden, false),
        f.notes
      ) = false
  ),
  active_flows as (
    select
      flow_rules.*,
      case
        when coalesce(flow_rules.rule_json ->> 'alertOffsetMinutes', '') ~ '^-?[0-9]+$'
          then (flow_rules.rule_json ->> 'alertOffsetMinutes')::integer
        else -1
      end as alert_offset_minutes,
      case
        when lower(coalesce(flow_rules.rule_json ->> 'allDay', 'false')) = 'true'
          then true
        else false
      end as rule_all_day,
      case
        when coalesce(flow_rules.rule_json ->> 'startLocal', '') ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}'
          then ((flow_rules.rule_json ->> 'startLocal')::timestamp)::time
        else time '09:00'
      end as rule_start_time
    from flow_rules
    where not exists (
      select 1
      from public.event_deletion_trash edt
      where edt.user_id = flow_rules.user_id
        and edt.purged_at is null
        and edt.purge_after > timezone('utc', now())
        and edt.client_event_id in (
          'reminder:' || flow_rules.reminder_uuid::text,
          'reminder:rule:' || flow_rules.reminder_uuid::text
        )
    )
  ),
  trash_candidates as (
    select distinct on (edt.user_id, edt.client_event_id)
      edt.user_id,
      edt.client_event_id,
      coalesce(edt.row_data ->> 'title', edt.title, active_flows.name) as title,
      coalesce(
        edt.row_data ->> 'detail',
        'color=' || lpad(to_hex((active_flows.color & 16777215)::integer), 6, '0') ||
          case
            when active_flows.alert_offset_minutes is not null
              then ';alert=' || active_flows.alert_offset_minutes::text
            else ''
          end ||
          ';repeat=' || coalesce((active_flows.rule_json -> 'repeat')::text, '{"kind":"none","interval":1,"weekdays":[],"monthDay":null,"monthDays":[],"decanDays":[],"kemeticMonthDays":[]}') ||
          ';'
      ) as detail,
      coalesce(edt.row_data ->> 'location', null) as location,
      coalesce((edt.row_data ->> 'all_day')::boolean, active_flows.rule_all_day, false) as all_day,
      coalesce((edt.row_data ->> 'starts_at')::timestamp with time zone, edt.starts_at) as starts_at,
      coalesce(
        (edt.row_data ->> 'ends_at')::timestamp with time zone,
        edt.ends_at,
        case
          when coalesce((edt.row_data ->> 'all_day')::boolean, active_flows.rule_all_day, false)
            then null
          else coalesce((edt.row_data ->> 'starts_at')::timestamp with time zone, edt.starts_at) + interval '30 minutes'
        end
      ) as ends_at,
      coalesce(
        nullif(edt.row_data ->> 'flow_local_id', '')::integer,
        active_flows.id::integer
      ) as flow_local_id,
      coalesce(
        nullif(edt.row_data ->> 'calendar_id', '')::uuid,
        edt.calendar_id,
        active_flows.calendar_id
      ) as calendar_id,
      coalesce(edt.row_data ->> 'category', active_flows.rule_json ->> 'category') as category,
      1 as source_priority
    from public.event_deletion_trash edt
    join active_flows
      on active_flows.user_id = edt.user_id
     and active_flows.reminder_uuid = public.user_event_reminder_uuid(edt.client_event_id)
    where edt.purged_at is null
      and edt.purge_after > timezone('utc', now())
      and edt.client_event_id like ('reminder:' || active_flows.reminder_uuid::text || ':%')
      and edt.starts_at >= (date_trunc('day', timezone('utc', now())) at time zone 'UTC')
      and edt.starts_at is not null
    order by edt.user_id, edt.client_event_id, edt.deleted_at desc
  ),
  scheduled_base as (
    select
      sn.*,
      active_flows.id as flow_id,
      active_flows.name as flow_name,
      active_flows.color as flow_color,
      active_flows.calendar_id as flow_calendar_id,
      active_flows.rule_json,
      active_flows.profile_timezone,
      active_flows.alert_offset_minutes,
      active_flows.rule_all_day,
      active_flows.rule_start_time,
      substring(sn.client_event_id from ':([0-9]{4}-[0-9]{2}-[0-9]{2})$') as occurrence_date_text
    from public.scheduled_notifications sn
    join active_flows
      on active_flows.user_id = sn.user_id
     and active_flows.reminder_uuid = public.user_event_reminder_uuid(sn.client_event_id)
    where sn.notification_type = 'event_start'
      and sn.client_event_id like ('reminder:' || active_flows.reminder_uuid::text || ':%')
  ),
  scheduled_candidates as (
    select distinct on (scheduled_base.user_id, scheduled_base.client_event_id)
      scheduled_base.user_id,
      scheduled_base.client_event_id,
      coalesce(scheduled_base.rule_json ->> 'title', scheduled_base.title, scheduled_base.flow_name) as title,
      'color=' || lpad(to_hex((scheduled_base.flow_color & 16777215)::integer), 6, '0') ||
        case
          when scheduled_base.alert_offset_minutes is not null
            then ';alert=' || scheduled_base.alert_offset_minutes::text
          else ''
        end ||
        ';repeat=' || coalesce((scheduled_base.rule_json -> 'repeat')::text, '{"kind":"none","interval":1,"weekdays":[],"monthDay":null,"monthDays":[],"decanDays":[],"kemeticMonthDays":[]}') ||
        ';' as detail,
      null::text as location,
      scheduled_base.rule_all_day as all_day,
      ((scheduled_base.occurrence_date_text::date + scheduled_base.rule_start_time) at time zone scheduled_base.profile_timezone) as starts_at,
      case
        when scheduled_base.rule_all_day then null::timestamp with time zone
        else ((scheduled_base.occurrence_date_text::date + scheduled_base.rule_start_time) at time zone scheduled_base.profile_timezone) + interval '30 minutes'
      end as ends_at,
      scheduled_base.flow_id::integer as flow_local_id,
      scheduled_base.flow_calendar_id as calendar_id,
      scheduled_base.rule_json ->> 'category' as category,
      2 as source_priority
    from scheduled_base
    where scheduled_base.occurrence_date_text is not null
      and scheduled_base.occurrence_date_text::date >= (timezone(scheduled_base.profile_timezone, now()))::date
    order by scheduled_base.user_id, scheduled_base.client_event_id, scheduled_base.updated_at desc nulls last
  ),
  ranked_candidates as (
    select distinct on (candidate_rows.user_id, candidate_rows.client_event_id)
      candidate_rows.*
    from (
      select * from trash_candidates
      union all
      select * from scheduled_candidates
    ) candidate_rows
    where candidate_rows.client_event_id is not null
      and btrim(candidate_rows.client_event_id) <> ''
      and candidate_rows.calendar_id is not null
    order by candidate_rows.user_id, candidate_rows.client_event_id, candidate_rows.source_priority
  )
  select
    ranked_candidates.user_id,
    ranked_candidates.client_event_id,
    ranked_candidates.title,
    ranked_candidates.detail,
    ranked_candidates.location,
    ranked_candidates.all_day,
    ranked_candidates.starts_at,
    ranked_candidates.ends_at,
    ranked_candidates.flow_local_id,
    ranked_candidates.calendar_id,
    ranked_candidates.category,
    ranked_candidates.source_priority
  from ranked_candidates;

  delete from public.event_deletion_trash edt
  using reminder_restore_candidates c
  where edt.user_id = c.user_id
    and edt.client_event_id = c.client_event_id
    and edt.purged_at is null;

  get diagnostics v_tombstones_removed = row_count;

  insert into public.user_events (
    user_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    calendar_id,
    category,
    updated_at
  )
  select
    c.user_id,
    c.client_event_id,
    c.title,
    c.detail,
    c.location,
    c.all_day,
    c.starts_at,
    c.ends_at,
    c.flow_local_id,
    c.calendar_id,
    c.category,
    now()
  from reminder_restore_candidates c
  on conflict (user_id, client_event_id) do update
  set
    title = excluded.title,
    detail = excluded.detail,
    location = excluded.location,
    all_day = excluded.all_day,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    flow_local_id = excluded.flow_local_id,
    calendar_id = excluded.calendar_id,
    category = excluded.category,
    updated_at = now();

  get diagnostics v_restored = row_count;

  with flow_rules as (
    select
      f.*,
      public.try_parse_jsonb(f.notes) as rule_json
    from public.flows f
    where f.is_reminder = true
      and f.active = true
      and coalesce(f.is_hidden, false) = false
      and f.reminder_uuid is not null
      and public.flow_is_deleted_state(
        f.active,
        coalesce(f.is_hidden, false),
        f.notes
      ) = false
  ),
  active_flows as (
    select
      flow_rules.*,
      case
        when coalesce(flow_rules.rule_json ->> 'alertOffsetMinutes', '') ~ '^-?[0-9]+$'
          then (flow_rules.rule_json ->> 'alertOffsetMinutes')::integer
        else -1
      end as alert_offset_minutes
    from flow_rules
    where not exists (
      select 1
      from public.event_deletion_trash edt
      where edt.user_id = flow_rules.user_id
        and edt.purged_at is null
        and edt.purge_after > timezone('utc', now())
        and edt.client_event_id in (
          'reminder:' || flow_rules.reminder_uuid::text,
          'reminder:rule:' || flow_rules.reminder_uuid::text
        )
    )
  )
  update public.scheduled_notifications sn
  set
    is_active = true,
    updated_at = now(),
    claimed_at = null,
    claim_token = null,
    last_error = null
  from active_flows
  where sn.user_id = active_flows.user_id
    and public.user_event_reminder_uuid(sn.client_event_id) = active_flows.reminder_uuid
    and sn.notification_type = 'event_start'
    and sn.scheduled_at >= timezone('utc', now())
    and active_flows.alert_offset_minutes <> -1
    and sn.is_active = false;

  get diagnostics v_reactivated = row_count;

  reminder_event_rows_restored := coalesce(v_restored, 0);
  reminder_notifications_reactivated := coalesce(v_reactivated, 0);
  reminder_occurrence_tombstones_removed := coalesce(v_tombstones_removed, 0);
  return next;
end;
$$;

revoke all on function public.repair_active_reminder_filing_backbone() from public;
grant execute on function public.repair_active_reminder_filing_backbone() to service_role;

comment on function public.repair_active_reminder_filing_backbone() is
'Repeatable reminder repair. Active visible reminder flows are the rule source; this restores their materialized user_events from archived occurrences or notification history, removes false occurrence tombstones for restored rows, and reactivates future alert rows.';

select * from public.repair_active_reminder_filing_backbone();

notify pgrst, 'reload schema';
