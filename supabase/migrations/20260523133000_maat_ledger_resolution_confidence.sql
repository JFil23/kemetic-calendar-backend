-- Add resolution confidence and avoid resolving obligations from weak matches.

alter table public.maat_obligations
  add column if not exists resolution_confidence text,
  add column if not exists resolution_match_reason text;

alter table public.maat_restoration_attempts
  add column if not exists resolution_confidence text,
  add column if not exists resolution_match_reason text;

alter table public.maat_obligations
  drop constraint if exists maat_obligations_resolution_confidence_check;

alter table public.maat_obligations
  add constraint maat_obligations_resolution_confidence_check check (
    resolution_confidence is null
    or resolution_confidence in (
      'exact_source_match',
      'same_kind_same_day',
      'same_axis_same_decan',
      'fallback_axis_match'
    )
  );

alter table public.maat_restoration_attempts
  drop constraint if exists maat_restoration_attempts_resolution_confidence_check;

alter table public.maat_restoration_attempts
  add constraint maat_restoration_attempts_resolution_confidence_check check (
    resolution_confidence is null
    or resolution_confidence in (
      'exact_source_match',
      'same_kind_same_day',
      'same_axis_same_decan',
      'fallback_axis_match'
    )
  );

create or replace function public.maat_safe_date(p_value text)
returns date
language sql
immutable
as $$
  select case
    when p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then p_value::date
    else null
  end
$$;

drop function if exists public.resolve_maat_obligation(
  uuid,
  text,
  text,
  jsonb,
  timestamptz
);

create or replace function public.resolve_maat_obligation(
  p_obligation_id uuid,
  p_source_type text,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_resolved_at timestamptz default now(),
  p_resolution_confidence text default 'fallback_axis_match',
  p_resolution_match_reason text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_confidence text := coalesce(p_resolution_confidence, 'fallback_axis_match');
begin
  if v_confidence not in (
    'exact_source_match',
    'same_kind_same_day',
    'same_axis_same_decan',
    'fallback_axis_match'
  ) then
    raise exception 'invalid resolution confidence: %', v_confidence;
  end if;

  if v_confidence = 'fallback_axis_match' then
    update public.maat_obligations
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'last_weak_resolution_source_type', p_source_type,
          'last_weak_resolution_source_id', p_source_id,
          'last_weak_resolution_metadata', coalesce(p_metadata, '{}'::jsonb),
          'last_weak_resolution_at', p_resolved_at,
          'last_weak_resolution_confidence', v_confidence,
          'last_weak_resolution_reason', p_resolution_match_reason
        ),
        updated_at = now()
    where id = p_obligation_id
      and status in ('open', 'acted');

    get diagnostics v_updated = row_count;
    return 0;
  end if;

  update public.maat_obligations
  set status = 'resolved',
      resolved_at = coalesce(resolved_at, p_resolved_at),
      resolution_source_type = p_source_type,
      resolution_source_id = p_source_id,
      resolution_confidence = v_confidence,
      resolution_match_reason = p_resolution_match_reason,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'resolution_source_type', p_source_type,
        'resolution_source_id', p_source_id,
        'resolution_metadata', coalesce(p_metadata, '{}'::jsonb),
        'resolution_confidence', v_confidence,
        'resolution_match_reason', p_resolution_match_reason,
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
      resolution_confidence = v_confidence,
      resolution_match_reason = p_resolution_match_reason,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'resolution_source_type', p_source_type,
        'resolution_source_id', p_source_id,
        'resolution_metadata', coalesce(p_metadata, '{}'::jsonb),
        'resolution_confidence', v_confidence,
        'resolution_match_reason', p_resolution_match_reason,
        'resolved_at', p_resolved_at
      ),
      updated_at = now()
  where obligation_id = p_obligation_id
    and status in ('suggested', 'shown', 'opened', 'acted');

  return v_updated;
end;
$$;

drop function if exists public.resolve_maat_obligations_for_field(
  uuid,
  text,
  text,
  text,
  jsonb,
  timestamptz
);

create or replace function public.resolve_maat_obligations_for_field(
  p_user_id uuid,
  p_field text,
  p_source_type text,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_resolved_at timestamptz default now(),
  p_event_date date default null,
  p_decan_period_key text default null,
  p_source_ref text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obligation record;
begin
  select
    ranked.id,
    ranked.resolution_confidence,
    ranked.resolution_match_reason
  into v_obligation
  from (
    select
      o.id,
      case
        when coalesce(p_source_ref, p_source_id) is not null
          and (
            o.source_id = coalesce(p_source_ref, p_source_id)
            or o.metadata ->> 'source_id' = coalesce(p_source_ref, p_source_id)
            or o.metadata ->> 'event_id' = coalesce(p_source_ref, p_source_id)
            or o.suggested_restoration ->> 'source_id' = coalesce(p_source_ref, p_source_id)
            or exists (
              select 1
              from public.maat_restoration_attempts a
              where a.obligation_id = o.id
                and (
                  a.cta_ref = coalesce(p_source_ref, p_source_id)
                  or a.metadata ->> 'source_id' = coalesce(p_source_ref, p_source_id)
                  or a.metadata ->> 'event_id' = coalesce(p_source_ref, p_source_id)
                )
            )
          )
          then 'exact_source_match'
        when p_event_date is not null
          and (
            public.maat_safe_date(o.metadata ->> 'local_date') = p_event_date
            or public.maat_safe_date(o.metadata ->> 'occurred_on') = p_event_date
            or public.maat_safe_date(o.suggested_restoration ->> 'local_date') = p_event_date
          )
          then 'same_kind_same_day'
        when p_decan_period_key is not null
          and o.decan_period_key = p_decan_period_key
          then 'same_axis_same_decan'
        when p_event_date is not null
          and split_part(o.decan_period_key, ':', 1) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and split_part(o.decan_period_key, ':', 2) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and p_event_date between split_part(o.decan_period_key, ':', 1)::date
            and split_part(o.decan_period_key, ':', 2)::date
          then 'same_axis_same_decan'
        else 'fallback_axis_match'
      end as resolution_confidence,
      case
        when coalesce(p_source_ref, p_source_id) is not null
          and (
            o.source_id = coalesce(p_source_ref, p_source_id)
            or o.metadata ->> 'source_id' = coalesce(p_source_ref, p_source_id)
            or o.metadata ->> 'event_id' = coalesce(p_source_ref, p_source_id)
            or o.suggested_restoration ->> 'source_id' = coalesce(p_source_ref, p_source_id)
            or exists (
              select 1
              from public.maat_restoration_attempts a
              where a.obligation_id = o.id
                and (
                  a.cta_ref = coalesce(p_source_ref, p_source_id)
                  or a.metadata ->> 'source_id' = coalesce(p_source_ref, p_source_id)
                  or a.metadata ->> 'event_id' = coalesce(p_source_ref, p_source_id)
                )
            )
          )
          then 'completion source matched obligation or active attempt'
        when p_event_date is not null
          and (
            public.maat_safe_date(o.metadata ->> 'local_date') = p_event_date
            or public.maat_safe_date(o.metadata ->> 'occurred_on') = p_event_date
            or public.maat_safe_date(o.suggested_restoration ->> 'local_date') = p_event_date
          )
          then 'completion date matched obligation local date'
        when p_decan_period_key is not null
          and o.decan_period_key = p_decan_period_key
          then 'completion matched decan period key'
        when p_event_date is not null
          and split_part(o.decan_period_key, ':', 1) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and split_part(o.decan_period_key, ':', 2) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and p_event_date between split_part(o.decan_period_key, ':', 1)::date
            and split_part(o.decan_period_key, ':', 2)::date
          then 'completion date fell inside obligation decan'
        else 'field matched but source/date/decan did not'
      end as resolution_match_reason,
      case
        when coalesce(p_source_ref, p_source_id) is not null
          and (
            o.source_id = coalesce(p_source_ref, p_source_id)
            or o.metadata ->> 'source_id' = coalesce(p_source_ref, p_source_id)
            or o.metadata ->> 'event_id' = coalesce(p_source_ref, p_source_id)
            or o.suggested_restoration ->> 'source_id' = coalesce(p_source_ref, p_source_id)
            or exists (
              select 1
              from public.maat_restoration_attempts a
              where a.obligation_id = o.id
                and (
                  a.cta_ref = coalesce(p_source_ref, p_source_id)
                  or a.metadata ->> 'source_id' = coalesce(p_source_ref, p_source_id)
                  or a.metadata ->> 'event_id' = coalesce(p_source_ref, p_source_id)
                )
            )
          )
          then 1
        when p_event_date is not null
          and (
            public.maat_safe_date(o.metadata ->> 'local_date') = p_event_date
            or public.maat_safe_date(o.metadata ->> 'occurred_on') = p_event_date
            or public.maat_safe_date(o.suggested_restoration ->> 'local_date') = p_event_date
          )
          then 2
        when p_decan_period_key is not null and o.decan_period_key = p_decan_period_key
          then 3
        when p_event_date is not null
          and split_part(o.decan_period_key, ':', 1) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and split_part(o.decan_period_key, ':', 2) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and p_event_date between split_part(o.decan_period_key, ':', 1)::date
            and split_part(o.decan_period_key, ':', 2)::date
          then 4
        else 9
      end as resolution_rank,
      o.updated_at
    from public.maat_obligations o
    where o.user_id = p_user_id
      and o.field = p_field
      and o.status in ('open', 'acted')
      and o.created_at >= p_resolved_at - interval '30 days'
  ) ranked
  order by ranked.resolution_rank asc, ranked.updated_at asc
  limit 1;

  if v_obligation.id is null then
    return 0;
  end if;

  return public.resolve_maat_obligation(
    v_obligation.id,
    p_source_type,
    p_source_id,
    p_metadata,
    p_resolved_at,
    v_obligation.resolution_confidence,
    v_obligation.resolution_match_reason
  );
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
  v_event_date date := null;
begin
  if tg_op = 'UPDATE' then
    v_was_done := old.status = 'done';
  end if;

  if new.status = 'done' and not v_was_done then
    v_event_date := coalesce(new.due_date, coalesce(new.completed_at, now())::date);

    perform public.resolve_maat_obligations_for_field(
      new.user_id,
      'visible_work',
      'todo',
      new.id::text,
      jsonb_build_object(
        'todo_id', new.id,
        'title', new.title,
        'due_date', new.due_date,
        'completed_at', coalesce(new.completed_at, now()),
        'event_date', v_event_date
      ),
      coalesce(new.completed_at, now()),
      v_event_date,
      null,
      new.id::text
    );
  end if;
  return new;
end;
$$;

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
      coalesce(new.occurred_at, new.created_at, now()),
      new.occurred_on,
      null,
      coalesce(new.event_id, new.id::text)
    );
  end if;

  return new;
end;
$$;

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
      now(),
      new.local_date,
      null,
      coalesce(new.todo_id::text, new.event_id::text, new.source_key, new.id::text)
    );
  end if;

  return new;
end;
$$;

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
      new.created_at,
      'exact_source_match',
      'completed flow matched restoration CTA'
    );
  end loop;

  return new;
end;
$$;

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
  o.resolution_confidence,
  o.resolution_match_reason,
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
  timestamptz,
  text,
  text
) to service_role;

grant execute on function public.resolve_maat_obligations_for_field(
  uuid,
  text,
  text,
  text,
  jsonb,
  timestamptz,
  date,
  text,
  text
) to service_role;

grant select on public.maat_ledger_restoration_health to service_role;
