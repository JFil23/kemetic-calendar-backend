-- Delivery timing proof: claim reminders before push, record delivery timing
-- events, and expose cron/delivery health views for ops review.

alter table public.reminders
  drop constraint if exists reminders_status_check;

alter table public.reminders
  add constraint reminders_status_check
  check (
    status = any (
      array[
        'pending'::text,
        'claimed'::text,
        'sent_push'::text,
        'shown_in_app'::text,
        'completed'::text
      ]
    )
  );

comment on column public.reminders.status is
'Reminder delivery lifecycle. Cron claims pending rows before sending so overlapping runs cannot double-send.';

create or replace function public.claim_due_reminders(
  p_now timestamp with time zone default now(),
  p_limit integer default 500
)
returns table(
  id uuid,
  user_id uuid,
  title text,
  detail text,
  alert_at timestamp with time zone,
  channel text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select r.id
    from public.reminders r
    where r.channel = 'push_and_in_app'
      and (
        r.status = 'pending'
        or (
          r.status = 'claimed'
          and r.updated_at <= p_now - interval '5 minutes'
        )
      )
      and r.alert_at <= p_now
    order by r.alert_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 500), 500))
  ),
  claimed as (
    update public.reminders r
       set status = 'claimed',
           updated_at = p_now
      from due
     where r.id = due.id
     returning r.id, r.user_id, r.title, r.detail, r.alert_at, r.channel, r.status
  )
  select
    c.id,
    c.user_id,
    c.title,
    c.detail,
    c.alert_at,
    c.channel,
    c.status
  from claimed c
  order by c.alert_at asc;
end;
$$;

comment on function public.claim_due_reminders(timestamp with time zone, integer)
is 'Atomically claims due reminder rows with FOR UPDATE SKIP LOCKED so overlapping cron_reminder_push runs cannot send the same reminder twice.';

create table if not exists public.maat_delivery_timing_events (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null,
  delivery_kind text not null,
  target_table text not null,
  target_id text not null,
  user_id uuid,
  scheduled_for timestamp with time zone,
  cron_picked_at timestamp with time zone,
  function_started_at timestamp with time zone,
  delivered_at timestamp with time zone,
  delivery_latency_seconds integer generated always as (
    case
      when scheduled_for is null or delivered_at is null then null
      else greatest(
        0,
        floor(extract(epoch from delivered_at - scheduled_for))::integer
      )
    end
  ) stored,
  cron_job_name text not null,
  delivery_attempt integer not null default 1,
  delivery_status text not null,
  skip_reason text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint maat_delivery_timing_events_status_check check (
    delivery_status = any (
      array[
        'picked'::text,
        'sent'::text,
        'skipped'::text,
        'failed'::text,
        'duplicate_guarded'::text
      ]
    )
  )
);

create index if not exists idx_maat_delivery_timing_events_created
  on public.maat_delivery_timing_events (created_at desc);

create index if not exists idx_maat_delivery_timing_events_kind_status
  on public.maat_delivery_timing_events (
    delivery_kind,
    delivery_status,
    created_at desc
  );

create index if not exists idx_maat_delivery_timing_events_key
  on public.maat_delivery_timing_events (delivery_key);

create index if not exists idx_maat_delivery_timing_events_target
  on public.maat_delivery_timing_events (target_table, target_id);

comment on table public.maat_delivery_timing_events is
'Normalized delivery proof events for scheduled output paths. A row records picked, sent, skipped, failed, or duplicate-guarded state with latency fields.';

drop view if exists public.maat_delivery_recent_events;
drop view if exists public.maat_delivery_timing_health;

create or replace view public.maat_delivery_recent_events
with (security_invoker = true) as
select
  e.id,
  e.delivery_key,
  e.delivery_kind,
  e.target_table,
  e.target_id,
  e.user_id,
  e.scheduled_for,
  e.cron_picked_at,
  e.function_started_at,
  e.delivered_at,
  e.delivery_latency_seconds,
  case
    when e.delivery_kind in ('reminder', 'scheduled_notification') then 90
    when e.delivery_kind = 'decan_reflection' then 420
    when e.delivery_kind in ('decan_opening', 'drift_nudge', 'strength_nudge')
      then 3600
    else 300
  end as sla_seconds,
  e.cron_job_name,
  e.delivery_attempt,
  e.delivery_status,
  e.skip_reason,
  e.error_code,
  e.metadata,
  e.created_at,
  coalesce(
    e.delivery_latency_seconds >
      case
        when e.delivery_kind in ('reminder', 'scheduled_notification') then 90
        when e.delivery_kind = 'decan_reflection' then 420
        when e.delivery_kind in ('decan_opening', 'drift_nudge', 'strength_nudge')
          then 3600
        else 300
      end,
    false
  ) as is_late
from public.maat_delivery_timing_events e;

create or replace view public.maat_delivery_timing_health
with (security_invoker = true) as
with duplicate_sent_keys as (
  select delivery_key
  from public.maat_delivery_timing_events
  where delivery_status = 'sent'
  group by delivery_key
  having count(*) > 1
)
select
  e.delivery_kind,
  e.cron_job_name,
  count(*) filter (where e.delivery_status = 'picked') as picked_count,
  count(*) filter (where e.delivery_status = 'sent') as sent_count,
  count(*) filter (where e.delivery_status = 'skipped') as skipped_count,
  count(*) filter (where e.delivery_status = 'failed') as failed_count,
  count(*) filter (where e.delivery_status = 'duplicate_guarded')
    as duplicate_guarded_count,
  count(distinct e.delivery_key) filter (
    where d.delivery_key is not null
  ) as duplicate_sent_key_count,
  max(e.created_at) as last_event_at,
  max(e.delivered_at) filter (where e.delivery_status = 'sent')
    as last_sent_at,
  max(e.delivery_latency_seconds) filter (where e.delivery_status = 'sent')
    as max_latency_seconds,
  round(
    avg(e.delivery_latency_seconds) filter (where e.delivery_status = 'sent'),
    2
  ) as avg_latency_seconds,
  count(*) filter (
    where e.delivery_status = 'sent'
      and coalesce(
        e.delivery_latency_seconds >
          case
            when e.delivery_kind in ('reminder', 'scheduled_notification') then 90
            when e.delivery_kind = 'decan_reflection' then 420
            when e.delivery_kind in (
              'decan_opening',
              'drift_nudge',
              'strength_nudge'
            ) then 3600
            else 300
          end,
        false
      )
  ) as late_count
from public.maat_delivery_timing_events e
left join duplicate_sent_keys d on d.delivery_key = e.delivery_key
group by e.delivery_kind, e.cron_job_name;

do $$
begin
  if to_regclass('cron.job') is not null
     and to_regclass('cron.job_run_details') is not null then
    execute $view$
      create or replace view public.maat_delivery_cron_health
      with (security_invoker = true) as
      select
        j.jobname::text as job_name,
        j.schedule::text as schedule,
        j.active,
        max(d.start_time) as last_started_at,
        max(d.end_time) as last_finished_at,
        (array_agg(d.status order by d.start_time desc)
          filter (where d.status is not null))[1]::text as last_status,
        max(d.end_time) filter (where d.status = 'succeeded')
          as last_success_at,
        count(*) filter (where d.status = 'succeeded')::integer
          as success_count,
        count(*) filter (
          where d.status is not null and d.status <> 'succeeded'
        )::integer as failure_count,
        case
          when max(d.end_time) filter (where d.status = 'succeeded') is null
            then null
          else floor(extract(epoch from (
            now() - max(d.end_time) filter (where d.status = 'succeeded')
          )))::integer
        end as seconds_since_success,
        case
          when not j.active then 'paused'
          when max(d.end_time) filter (where d.status = 'succeeded') is null
            then 'no_success_yet'
          when j.jobname = 'cron_reminder_push_1m'
            and now() - max(d.end_time) filter (where d.status = 'succeeded')
              > interval '3 minutes'
            then 'late'
          when j.jobname = 'decan_reflection_push_5m'
            and now() - max(d.end_time) filter (where d.status = 'succeeded')
              > interval '15 minutes'
            then 'late'
          when j.jobname in (
            'maat_guidance_evaluate_hourly',
            'maat_guidance_decan_opening_hourly'
          )
            and now() - max(d.end_time) filter (where d.status = 'succeeded')
              > interval '2 hours'
            then 'late'
          else 'healthy'
        end as health_status
      from cron.job j
      left join cron.job_run_details d on d.jobid = j.jobid
      where j.jobname in (
        'cron_reminder_push_1m',
        'decan_reflection_push_5m',
        'maat_guidance_evaluate_hourly',
        'maat_guidance_decan_opening_hourly'
      )
      group by j.jobname, j.schedule, j.active
    $view$;
  else
    create or replace view public.maat_delivery_cron_health
    with (security_invoker = true) as
    select
      null::text as job_name,
      null::text as schedule,
      null::boolean as active,
      null::timestamp with time zone as last_started_at,
      null::timestamp with time zone as last_finished_at,
      null::text as last_status,
      null::timestamp with time zone as last_success_at,
      0::integer as success_count,
      0::integer as failure_count,
      null::integer as seconds_since_success,
      'cron_unavailable'::text as health_status
    where false;
  end if;
end
$$;

insert into public.maat_delivery_timing_events (
  delivery_key,
  delivery_kind,
  target_table,
  target_id,
  user_id,
  scheduled_for,
  cron_picked_at,
  function_started_at,
  delivered_at,
  cron_job_name,
  delivery_attempt,
  delivery_status,
  skip_reason,
  error_code,
  metadata,
  created_at
)
select
  sent.delivery_key,
  sent.delivery_kind,
  sent.target_table,
  sent.target_id,
  sent.user_id,
  sent.scheduled_for,
  coalesce(sent.cron_picked_at, sent.function_started_at, sent.created_at),
  sent.function_started_at,
  null,
  sent.cron_job_name,
  sent.delivery_attempt,
  'picked',
  null,
  null,
  sent.metadata || jsonb_build_object('backfilled_from_sent_event', true),
  least(sent.created_at, coalesce(sent.function_started_at, sent.created_at))
from public.maat_delivery_timing_events sent
where sent.delivery_status = 'sent'
  and not exists (
    select 1
    from public.maat_delivery_timing_events picked
    where picked.delivery_key = sent.delivery_key
      and picked.delivery_status = 'picked'
  );

revoke all on function public.claim_due_reminders(timestamp with time zone, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_reminders(timestamp with time zone, integer)
  to service_role;
grant select, insert on public.maat_delivery_timing_events to service_role;
grant select on public.maat_delivery_recent_events to service_role;
grant select on public.maat_delivery_timing_health to service_role;
grant select on public.maat_delivery_cron_health to service_role;
