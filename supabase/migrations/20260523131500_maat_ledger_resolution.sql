-- Concrete resolution wiring for the durable Ma'at ledger.

alter table public.maat_obligations
  add column if not exists resolution_source_type text,
  add column if not exists resolution_source_id text,
  add column if not exists release_source_type text,
  add column if not exists release_source_id text,
  add column if not exists release_reason text;

alter table public.maat_restoration_attempts
  add column if not exists resolution_source_type text,
  add column if not exists resolution_source_id text,
  add column if not exists release_source_type text,
  add column if not exists release_source_id text,
  add column if not exists release_reason text,
  add column if not exists released_at timestamptz;

alter table public.maat_restoration_attempts
  drop constraint if exists maat_restoration_attempts_status_check;

alter table public.maat_restoration_attempts
  add constraint maat_restoration_attempts_status_check check (
    status in (
      'suggested',
      'shown',
      'opened',
      'acted',
      'resolved',
      'released',
      'dismissed',
      'expired',
      'repeated'
    )
  );

create or replace function public.resolve_maat_obligation(
  p_obligation_id uuid,
  p_source_type text,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_resolved_at timestamptz default now()
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  update public.maat_obligations
  set status = 'resolved',
      resolved_at = coalesce(resolved_at, p_resolved_at),
      resolution_source_type = p_source_type,
      resolution_source_id = p_source_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'resolution_source_type', p_source_type,
        'resolution_source_id', p_source_id,
        'resolution_metadata', coalesce(p_metadata, '{}'::jsonb),
        'resolved_at', p_resolved_at
      ),
      updated_at = now()
  where id = p_obligation_id
    and status in ('open', 'acted');

  get diagnostics v_updated = row_count;

  update public.maat_restoration_attempts
  set status = 'resolved',
      resolved_at = coalesce(resolved_at, p_resolved_at),
      resolution_source_type = p_source_type,
      resolution_source_id = p_source_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'resolution_source_type', p_source_type,
        'resolution_source_id', p_source_id,
        'resolution_metadata', coalesce(p_metadata, '{}'::jsonb),
        'resolved_at', p_resolved_at
      ),
      updated_at = now()
  where obligation_id = p_obligation_id
    and status in ('suggested', 'shown', 'opened', 'acted');

  return v_updated;
end;
$$;

create or replace function public.resolve_maat_obligations_for_field(
  p_user_id uuid,
  p_field text,
  p_source_type text,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_resolved_at timestamptz default now()
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obligation record;
  v_count integer := 0;
begin
  for v_obligation in
    select id
    from public.maat_obligations
    where user_id = p_user_id
      and field = p_field
      and status in ('open', 'acted')
      and created_at >= p_resolved_at - interval '30 days'
    order by updated_at desc
  loop
    v_count := v_count + public.resolve_maat_obligation(
      v_obligation.id,
      p_source_type,
      p_source_id,
      p_metadata,
      p_resolved_at
    );
  end loop;

  return v_count;
end;
$$;

create or replace function public.release_maat_obligation(
  p_obligation_id uuid,
  p_reason text default null,
  p_source_type text default 'user_release',
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'release_maat_obligation requires authenticated user';
  end if;

  update public.maat_obligations
  set status = 'released',
      released_at = coalesce(released_at, now()),
      release_source_type = p_source_type,
      release_source_id = p_source_id,
      release_reason = p_reason,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'release_source_type', p_source_type,
        'release_source_id', p_source_id,
        'release_reason', p_reason,
        'release_metadata', coalesce(p_metadata, '{}'::jsonb),
        'released_at', now()
      ),
      updated_at = now()
  where id = p_obligation_id
    and user_id = v_user_id
    and status in ('open', 'acted');

  get diagnostics v_updated = row_count;

  update public.maat_restoration_attempts
  set status = 'released',
      released_at = coalesce(released_at, now()),
      release_source_type = p_source_type,
      release_source_id = p_source_id,
      release_reason = p_reason,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'release_source_type', p_source_type,
        'release_source_id', p_source_id,
        'release_reason', p_reason,
        'release_metadata', coalesce(p_metadata, '{}'::jsonb),
        'released_at', now()
      ),
      updated_at = now()
  where obligation_id = p_obligation_id
    and user_id = v_user_id
    and status in ('suggested', 'shown', 'opened', 'acted');

  return v_updated;
end;
$$;

create or replace function public.resolve_maat_from_todo_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_done boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_done := old.status = 'done';
  end if;

  if new.status = 'done' and not v_was_done then
    perform public.resolve_maat_obligations_for_field(
      new.user_id,
      'visible_work',
      'todo',
      new.id::text,
      jsonb_build_object(
        'todo_id', new.id,
        'title', new.title,
        'due_date', new.due_date,
        'completed_at', coalesce(new.completed_at, now())
      ),
      coalesce(new.completed_at, now())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resolve_maat_from_todo_done on public.todos;
create trigger trg_resolve_maat_from_todo_done
after insert or update of status, completed_at on public.todos
for each row execute function public.resolve_maat_from_todo_done();

create or replace function public.resolve_maat_from_planner_badge_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags text[] := coalesce(new.tags, '{}'::text[]);
  v_field text := null;
begin
  if not ('planner' = any(v_tags) and 'state:done' = any(v_tags)) then
    return new;
  end if;

  if 'kind:nutrition' = any(v_tags) then
    v_field := 'provision';
  elsif 'kind:todo' = any(v_tags) then
    v_field := 'visible_work';
  end if;

  if v_field is not null then
    perform public.resolve_maat_obligations_for_field(
      new.user_id,
      v_field,
      'planner_badge',
      coalesce(new.event_id, new.id::text),
      jsonb_build_object(
        'badge_id', new.id,
        'event_id', new.event_id,
        'title', new.title,
        'occurred_on', new.occurred_on,
        'tags', v_tags
      ),
      coalesce(new.occurred_at, new.created_at, now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resolve_maat_from_planner_badge_done
  on public.journal_badges;
create trigger trg_resolve_maat_from_planner_badge_done
after insert on public.journal_badges
for each row execute function public.resolve_maat_from_planner_badge_done();

create or replace function public.resolve_maat_from_checklist_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_field text := null;
  v_was_done boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_done := old.status = 'done';
  end if;

  if new.status <> 'done' or v_was_done then
    return new;
  end if;

  if new.source = 'todo' or new.todo_id is not null then
    v_field := 'visible_work';
  elsif lower(coalesce(new.title, '')) ~ '(nutrition|meal|food|water|hydrate)' then
    v_field := 'provision';
  end if;

  if v_field is not null then
    perform public.resolve_maat_obligations_for_field(
      new.user_id,
      v_field,
      'checklist_item',
      new.id::text,
      jsonb_build_object(
        'checklist_item_id', new.id,
        'source', new.source,
        'source_key', new.source_key,
        'title', new.title,
        'local_date', new.local_date
      ),
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resolve_maat_from_checklist_done
  on public.checklist_items;
create trigger trg_resolve_maat_from_checklist_done
after insert or update of status on public.checklist_items
for each row execute function public.resolve_maat_from_checklist_done();

create or replace function public.resolve_maat_from_flow_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow_key text := null;
  v_attempt record;
begin
  if new.event_type <> 'flow_completed' then
    return new;
  end if;

  v_flow_key := nullif(coalesce(
    new.metadata ->> 'flow_id',
    new.metadata ->> 'flowId',
    new.flow_id::text
  ), '');

  if v_flow_key is null then
    return new;
  end if;

  for v_attempt in
    select distinct a.obligation_id
    from public.maat_restoration_attempts a
    where a.user_id = new.user_id
      and a.obligation_id is not null
      and a.status in ('suggested', 'shown', 'opened', 'acted')
      and a.cta_type in ('flow', 'flow_template', 'flow_personalized')
      and (
        a.metadata ->> 'flow_id' = v_flow_key
        or a.metadata ->> 'generated_flow_id' = v_flow_key
        or a.cta_ref = v_flow_key
      )
  loop
    perform public.resolve_maat_obligation(
      v_attempt.obligation_id,
      'flow_completed',
      v_flow_key,
      jsonb_build_object(
        'user_choice_event_id', new.id,
        'flow_id', v_flow_key,
        'metadata', new.metadata
      ),
      new.created_at
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_resolve_maat_from_flow_completed
  on public.user_choice_events;
create trigger trg_resolve_maat_from_flow_completed
after insert on public.user_choice_events
for each row execute function public.resolve_maat_from_flow_completed();

drop view if exists public.maat_ledger_restoration_health;

create or replace view public.maat_ledger_restoration_health as
select
  o.id as obligation_id,
  o.user_id,
  o.decan_period_key,
  o.obligation_key,
  o.field,
  o.status as obligation_status,
  o.open_count,
  o.broken_count,
  o.leak_score,
  o.axis_codes,
  o.isfet_patterns,
  o.suggested_restoration,
  o.last_delivery_id,
  o.resolution_source_type,
  o.resolution_source_id,
  o.release_source_type,
  o.release_source_id,
  o.release_reason,
  o.opened_at as obligation_opened_at,
  o.acted_at as obligation_acted_at,
  o.resolved_at as obligation_resolved_at,
  o.released_at as obligation_released_at,
  count(a.id) as attempt_count,
  count(a.id) as suggested_count,
  count(a.id) filter (where a.status = 'shown' or a.shown_at is not null) as shown_count,
  count(a.id) filter (where a.status = 'opened' or a.opened_at is not null) as opened_count,
  count(a.id) filter (where a.status = 'acted' or a.acted_at is not null) as acted_count,
  count(a.id) filter (where a.status = 'resolved' or a.resolved_at is not null) as resolved_count,
  count(a.id) filter (where a.status = 'released' or a.released_at is not null) as released_count,
  count(a.id) filter (where a.status = 'dismissed' or a.dismissed_at is not null) as dismissed_count,
  count(a.id) filter (where a.status = 'expired' or a.expired_at is not null) as expired_count,
  case
    when count(a.id) filter (where a.status = 'acted' or a.acted_at is not null) = 0
      then null
    else round(
      count(a.id) filter (where a.status = 'resolved' or a.resolved_at is not null)::numeric /
      nullif(count(a.id) filter (where a.status = 'acted' or a.acted_at is not null), 0),
      4
    )
  end as acted_to_resolved_rate,
  case
    when count(a.id) = 0 then null
    else round(
      count(a.id) filter (where a.status = 'resolved' or a.resolved_at is not null)::numeric /
      nullif(count(a.id), 0),
      4
    )
  end as suggested_to_resolved_rate,
  percentile_cont(0.5) within group (
    order by extract(epoch from (a.resolved_at - a.suggested_at))
  ) filter (
    where a.resolved_at is not null and a.suggested_at is not null
  ) as median_time_to_resolve_seconds,
  max(a.suggested_at) as last_suggested_at,
  max(a.opened_at) as last_opened_at,
  max(a.acted_at) as last_acted_at,
  max(a.resolved_at) as last_resolved_at,
  max(a.released_at) as last_released_at,
  max(a.dismissed_at) as last_dismissed_at,
  max(a.expired_at) as last_expired_at,
  (
    select count(*)
    from public.maat_obligations prior
    where prior.user_id = o.user_id
      and prior.field = o.field
      and prior.id <> o.id
      and prior.created_at >= o.created_at - interval '30 days'
      and prior.created_at <= o.created_at
  ) as repeat_leak_count,
  (
    o.status = 'acted'
    and o.acted_at is not null
    and o.resolved_at is null
    and o.released_at is null
    and o.acted_at <= now() - interval '24 hours'
  ) as needs_scope_reduction,
  (array_agg(a.status order by a.updated_at desc)
    filter (where a.id is not null))[1] as last_attempt_status
from public.maat_obligations o
left join public.maat_restoration_attempts a
  on a.obligation_id = o.id
group by o.id;

grant execute on function public.resolve_maat_obligation(
  uuid,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;
grant execute on function public.resolve_maat_obligations_for_field(
  uuid,
  text,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;
grant execute on function public.release_maat_obligation(
  uuid,
  text,
  text,
  text,
  jsonb
) to authenticated, service_role;
grant select on public.maat_ledger_restoration_health to service_role;
