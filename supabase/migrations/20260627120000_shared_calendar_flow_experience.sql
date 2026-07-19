-- Shared-calendar placement is the source of truth for shared flow experience.
-- A flow assigned to a non-personal shared calendar gets/reuses a
-- shared_practice_rooms row, and its materialized user_events are stamped so
-- Day View can discover the shared-practice surface without a Practice Room
-- entry path.

drop index if exists public.shared_practice_rooms_active_calendar_source_start_idx;

create unique index if not exists shared_practice_rooms_active_calendar_source_start_fork_idx
  on public.shared_practice_rooms (
    calendar_id,
    source_flow_id,
    coalesce(start_date, date '0001-01-01')
  )
  where status = 'active'
    and shared_flow_id is distinct from source_flow_id;

create unique index if not exists shared_practice_rooms_active_calendar_shared_flow_idx
  on public.shared_practice_rooms(calendar_id, shared_flow_id)
  where shared_flow_id is not null
    and status = 'active';

create table if not exists public.shared_calendar_participant_sets (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  participant_key text not null unique,
  participant_user_ids uuid[] not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_calendar_participant_sets_calendar_idx
  on public.shared_calendar_participant_sets(calendar_id);

drop trigger if exists trg_touch_shared_calendar_participant_sets_updated_at
on public.shared_calendar_participant_sets;
create trigger trg_touch_shared_calendar_participant_sets_updated_at
before update on public.shared_calendar_participant_sets
for each row
execute function public.touch_shared_practice_updated_at();

create table if not exists public.joint_flow_experience_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, client_request_id)
);

alter table public.shared_calendar_participant_sets enable row level security;
alter table public.joint_flow_experience_requests enable row level security;

revoke all on public.shared_calendar_participant_sets from public;
revoke all on public.joint_flow_experience_requests from public;
grant all on public.shared_calendar_participant_sets to service_role;
grant all on public.joint_flow_experience_requests to service_role;

create or replace function public.shared_calendar_participant_key(
  p_participant_user_ids uuid[]
)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(coalesce(string_agg(normalized.user_id::text, ',' order by normalized.user_id::text), ''))
  from (
    select distinct user_id
    from unnest(coalesce(p_participant_user_ids, '{}'::uuid[])) as input(user_id)
    where user_id is not null
  ) normalized
$$;

create or replace function public.shared_calendar_has_exact_participants(
  p_calendar_id uuid,
  p_participant_user_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select distinct user_id
    from unnest(coalesce(p_participant_user_ids, '{}'::uuid[])) as input(user_id)
    where user_id is not null
  ),
  members as (
    select distinct scm.user_id
    from public.shared_calendar_members scm
    where scm.calendar_id = p_calendar_id
      and scm.status in ('accepted', 'pending')
  )
  select
    (select count(*) from target) = (select count(*) from members)
    and not exists (
      select user_id from target
      except
      select user_id from members
    )
    and not exists (
      select user_id from members
      except
      select user_id from target
    )
$$;

create or replace function public.ensure_shared_experience_for_flow_internal(
  p_flow_id bigint,
  p_calendar_id uuid,
  p_actor_id uuid default auth.uid(),
  p_require_permission boolean default true,
  p_source_flow_id_override bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow public.flows%rowtype;
  v_calendar public.shared_calendars%rowtype;
  v_room_id uuid;
  v_existing_source_flow_id bigint;
  v_flow_key text;
  v_created_by uuid;
  v_source_flow_id bigint;
begin
  if coalesce(p_flow_id, 0) <= 0 then
    raise exception 'FLOW_REQUIRED';
  end if;

  if p_calendar_id is null then
    raise exception 'CALENDAR_REQUIRED';
  end if;

  select *
    into v_calendar
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  if not found then
    raise exception 'CALENDAR_NOT_FOUND';
  end if;

  if coalesce(v_calendar.is_personal, false) then
    return null;
  end if;

  if p_require_permission then
    if p_actor_id is null then
      raise exception 'AUTH_REQUIRED';
    end if;

    if not public.shared_practice_can_edit_calendar(p_calendar_id, p_actor_id) then
      raise exception 'CALENDAR_NOT_EDITABLE';
    end if;
  end if;

  select *
    into v_flow
  from public.flows f
  where f.id = p_flow_id
    and f.calendar_id = p_calendar_id
    and coalesce(f.is_hidden, false) = false
  limit 1;

  if not found then
    raise exception 'FLOW_NOT_IN_CALENDAR';
  end if;

  v_source_flow_id := coalesce(
    nullif(p_source_flow_id_override, 0),
    p_flow_id
  );
  v_created_by := coalesce(p_actor_id, v_flow.user_id, v_calendar.owner_id);
  v_flow_key := nullif(btrim(v_flow.ai_metadata ->> 'flow_key'), '');

  select spr.id, spr.source_flow_id
    into v_room_id, v_existing_source_flow_id
  from public.shared_practice_rooms spr
  where spr.calendar_id = p_calendar_id
    and spr.status = 'active'
    and (
      spr.shared_flow_id = p_flow_id
      or (
        spr.shared_flow_id is null
        and spr.source_flow_id = v_source_flow_id
      )
    )
  order by
    case when spr.shared_flow_id = p_flow_id then 0 else 1 end,
    spr.created_at desc
  limit 1;

  if v_room_id is null then
    begin
      insert into public.shared_practice_rooms (
        calendar_id,
        source_flow_id,
        shared_flow_id,
        created_by,
        title,
        flow_key,
        start_date,
        end_date
      )
      values (
        p_calendar_id,
        v_source_flow_id,
        p_flow_id,
        v_created_by,
        v_flow.name,
        v_flow_key,
        v_flow.start_date,
        v_flow.end_date
      )
      returning id into v_room_id;
    exception when unique_violation then
      select spr.id, spr.source_flow_id
        into v_room_id, v_existing_source_flow_id
      from public.shared_practice_rooms spr
      where spr.calendar_id = p_calendar_id
        and spr.status = 'active'
        and (
          spr.shared_flow_id = p_flow_id
          or (
            spr.source_flow_id = v_source_flow_id
            and coalesce(spr.start_date, date '0001-01-01') =
                coalesce(v_flow.start_date, date '0001-01-01')
          )
        )
      order by
        case when spr.shared_flow_id = p_flow_id then 0 else 1 end,
        spr.created_at desc
      limit 1;
    end;
  end if;

  if v_room_id is null then
    raise exception 'SHARED_PRACTICE_ROOM_NOT_CREATED';
  end if;

  if p_source_flow_id_override is null and v_existing_source_flow_id is not null then
    v_source_flow_id := v_existing_source_flow_id;
  end if;

  update public.shared_practice_rooms spr
     set shared_flow_id = p_flow_id,
         source_flow_id = v_source_flow_id,
         title = coalesce(nullif(btrim(spr.title), ''), v_flow.name),
         flow_key = coalesce(nullif(btrim(spr.flow_key), ''), v_flow_key),
         start_date = coalesce(spr.start_date, v_flow.start_date),
         end_date = coalesce(spr.end_date, v_flow.end_date)
   where spr.id = v_room_id
     and (
       spr.shared_flow_id is distinct from p_flow_id
       or spr.source_flow_id is distinct from v_source_flow_id
       or nullif(btrim(spr.title), '') is null
       or (spr.flow_key is null and v_flow_key is not null)
       or (spr.start_date is null and v_flow.start_date is not null)
       or (spr.end_date is null and v_flow.end_date is not null)
     );

  update public.user_events ue
     set behavior_payload = coalesce(ue.behavior_payload, '{}'::jsonb) ||
       jsonb_build_object(
         'shared_practice_room_id', v_room_id::text,
         'source_flow_id', v_source_flow_id,
         'shared_flow_id', p_flow_id,
         'shared_calendar_id', p_calendar_id::text
       )
   where ue.calendar_id = p_calendar_id
     and coalesce(ue.category, '') <> 'tombstone'
     and public.user_event_matches_flow(
       p_flow_id,
       ue.flow_local_id,
       ue.client_event_id,
       ue.detail,
       ue.action_id,
       v_flow.ai_metadata
     );

  return v_room_id;
end;
$$;

create or replace function public.ensure_shared_experience_for_flow(
  p_flow_id bigint,
  p_calendar_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.ensure_shared_experience_for_flow_internal(
    p_flow_id,
    p_calendar_id,
    auth.uid(),
    true
  );
end;
$$;

revoke all on function public.ensure_shared_experience_for_flow(bigint, uuid)
from public;
grant execute on function public.ensure_shared_experience_for_flow(bigint, uuid)
to authenticated;

create or replace function public.stamp_shared_practice_room_on_user_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow_id bigint;
  v_room_id uuid;
  v_source_flow_id bigint;
  v_existing_room_id uuid;
  v_payload_base jsonb;
  v_payload_room_id_text text;
begin
  if new.calendar_id is null then
    return new;
  end if;

  if lower(coalesce(new.category, '')) = 'tombstone' then
    return new;
  end if;

  v_flow_id := coalesce(
    nullif(new.flow_local_id, 0)::bigint,
    public.flow_id_from_client_event_id(new.client_event_id),
    public.flow_id_from_detail_metadata(new.detail),
    public.flow_id_from_action_id(new.user_id, new.action_id)
  );

  if coalesce(v_flow_id, 0) <= 0 then
    if coalesce(new.behavior_payload, '{}'::jsonb) ?| array[
      'shared_practice_room_id',
      'shared_practice_entry_id',
      'source_flow_id',
      'shared_flow_id',
      'shared_calendar_id',
      'source_client_event_id',
      'flow_step_index',
      'flow_total_steps'
    ]::text[] then
      new.behavior_payload := coalesce(new.behavior_payload, '{}'::jsonb)
        - 'shared_practice_room_id'
        - 'shared_practice_entry_id'
        - 'source_flow_id'
        - 'shared_flow_id'
        - 'shared_calendar_id'
        - 'source_client_event_id'
        - 'flow_step_index'
        - 'flow_total_steps';
      if new.behavior_payload = '{}'::jsonb then
        new.behavior_payload := null;
      end if;
    end if;
    return new;
  end if;

  select spr.id, spr.source_flow_id
    into v_room_id, v_source_flow_id
  from public.shared_practice_rooms spr
  where spr.calendar_id = new.calendar_id
    and spr.shared_flow_id = v_flow_id
    and spr.status = 'active'
  order by spr.created_at desc
  limit 1;

  if v_room_id is null then
    if coalesce(new.behavior_payload, '{}'::jsonb) ?| array[
      'shared_practice_room_id',
      'shared_practice_entry_id',
      'source_flow_id',
      'shared_flow_id',
      'shared_calendar_id',
      'source_client_event_id',
      'flow_step_index',
      'flow_total_steps'
    ]::text[] then
      new.behavior_payload := coalesce(new.behavior_payload, '{}'::jsonb)
        - 'shared_practice_room_id'
        - 'shared_practice_entry_id'
        - 'source_flow_id'
        - 'shared_flow_id'
        - 'shared_calendar_id'
        - 'source_client_event_id'
        - 'flow_step_index'
        - 'flow_total_steps';
      if new.behavior_payload = '{}'::jsonb then
        new.behavior_payload := null;
      end if;
    end if;
    return new;
  end if;

  if v_flow_id between -2147483648 and 2147483647 then
    new.flow_local_id := v_flow_id::integer;
  end if;

  v_payload_base := coalesce(new.behavior_payload, '{}'::jsonb);
  if tg_op = 'UPDATE' then
    v_payload_room_id_text := coalesce(
      old.behavior_payload->>'shared_practice_room_id',
      v_payload_base->>'shared_practice_room_id'
    );
  else
    v_payload_room_id_text := v_payload_base->>'shared_practice_room_id';
  end if;

  if v_payload_room_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_existing_room_id := v_payload_room_id_text::uuid;
  end if;

  if v_existing_room_id is null or v_existing_room_id is distinct from v_room_id then
    v_payload_base := v_payload_base
      - 'shared_practice_room_id'
      - 'shared_practice_entry_id'
      - 'source_flow_id'
      - 'shared_flow_id'
      - 'shared_calendar_id'
      - 'source_client_event_id'
      - 'flow_step_index'
      - 'flow_total_steps';
  else
    v_payload_base := v_payload_base
      - 'shared_practice_entry_id';
  end if;

  new.behavior_payload := v_payload_base ||
    jsonb_build_object(
      'shared_practice_room_id', v_room_id::text,
      'source_flow_id', coalesce(v_source_flow_id, v_flow_id),
      'shared_flow_id', v_flow_id,
      'shared_calendar_id', new.calendar_id::text
    );

  return new;
end;
$$;

drop trigger if exists trg_user_events_stamp_shared_practice_room
on public.user_events;
create trigger trg_user_events_stamp_shared_practice_room
before insert or update of calendar_id, flow_local_id, client_event_id, detail, action_id, category, behavior_payload
on public.user_events
for each row
execute function public.stamp_shared_practice_room_on_user_event();

create or replace function public.maybe_ensure_shared_experience_for_flow_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.calendar_id is null or coalesce(new.is_hidden, false) then
    return new;
  end if;

  -- create_shared_practice_from_flow creates the room itself after it creates
  -- the forked flow. Let that older path keep its source-flow metadata.
  if coalesce(new.ai_metadata, '{}'::jsonb) ? 'shared_practice_source_flow_id' then
    return new;
  end if;

  if tg_op = 'INSERT' or new.calendar_id is distinct from old.calendar_id then
    begin
      perform public.ensure_shared_experience_for_flow_internal(
        new.id,
        new.calendar_id,
        coalesce(auth.uid(), new.user_id),
        false
      );
    exception when others then
      raise warning
        'shared experience ensure skipped for flow %, calendar %: %',
        new.id,
        new.calendar_id,
        sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_flows_maybe_ensure_shared_experience
on public.flows;
create trigger trg_flows_maybe_ensure_shared_experience
after insert or update of calendar_id
on public.flows
for each row
execute function public.maybe_ensure_shared_experience_for_flow_trigger();

create or replace function public.find_or_create_shared_calendar_for_participants(
  p_participant_user_ids uuid[],
  p_calendar_title text default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_participant_ids uuid[];
  v_participant_key text;
  v_calendar_id uuid;
  v_created boolean := false;
  v_title text := coalesce(nullif(btrim(p_calendar_title), ''), 'Shared Practice');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select array_agg(user_id order by user_id::text)
    into v_participant_ids
  from (
    select distinct user_id
    from (
      select v_uid as user_id
      union all
      select user_id
      from unnest(coalesce(p_participant_user_ids, '{}'::uuid[])) as input(user_id)
    ) raw
    where user_id is not null
  ) normalized;

  if coalesce(array_length(v_participant_ids, 1), 0) < 2 then
    raise exception 'PARTICIPANTS_REQUIRED';
  end if;

  if array_length(v_participant_ids, 1) > 25 then
    raise exception 'TOO_MANY_PARTICIPANTS';
  end if;

  if exists (
    select 1
    from unnest(v_participant_ids) as participant(user_id)
    left join auth.users au
      on au.id = participant.user_id
    where au.id is null
  ) then
    raise exception 'UNKNOWN_PARTICIPANT';
  end if;

  v_participant_key := public.shared_calendar_participant_key(v_participant_ids);
  perform pg_advisory_xact_lock(
    hashtext('shared_calendar_participants:' || v_participant_key)
  );

  select sc.id
    into v_calendar_id
  from public.shared_calendars sc
  join public.shared_calendar_members actor_member
    on actor_member.calendar_id = sc.id
   and actor_member.user_id = v_uid
   and actor_member.status = 'accepted'
   and actor_member.role in ('owner', 'editor')
  where sc.deleted_at is null
    and sc.is_personal = false
    and public.shared_calendar_has_exact_participants(sc.id, v_participant_ids)
  order by sc.updated_at desc
  limit 1;

  if v_calendar_id is null then
    select ps.calendar_id
      into v_calendar_id
    from public.shared_calendar_participant_sets ps
    join public.shared_calendars sc
      on sc.id = ps.calendar_id
     and sc.deleted_at is null
     and sc.is_personal = false
    join public.shared_calendar_members actor_member
      on actor_member.calendar_id = ps.calendar_id
     and actor_member.user_id = v_uid
     and actor_member.status = 'accepted'
     and actor_member.role in ('owner', 'editor')
    where ps.participant_key = v_participant_key
      and public.shared_calendar_has_exact_participants(ps.calendar_id, v_participant_ids)
    order by ps.updated_at desc
    limit 1;
  end if;

  if v_calendar_id is null then
    insert into public.shared_calendars (
      owner_id,
      name,
      color,
      icon,
      is_personal
    )
    values (
      v_uid,
      v_title,
      5099745,
      'calendar',
      false
    )
    returning id into v_calendar_id;

    insert into public.shared_calendar_members (
      calendar_id,
      user_id,
      role,
      status,
      invited_by,
      responded_at
    )
    values (
      v_calendar_id,
      v_uid,
      'owner',
      'accepted',
      v_uid,
      now()
    )
    on conflict (calendar_id, user_id)
    do update
      set role = 'owner',
          status = 'accepted',
          invited_by = v_uid,
          responded_at = now(),
          updated_at = now();

    insert into public.shared_calendar_members (
      calendar_id,
      user_id,
      role,
      status,
      invited_by,
      responded_at
    )
    select
      v_calendar_id,
      participant.user_id,
      'editor',
      'pending',
      v_uid,
      null
    from unnest(v_participant_ids) as participant(user_id)
    where participant.user_id <> v_uid
    on conflict (calendar_id, user_id)
    do update
      set role = excluded.role,
          status = excluded.status,
          invited_by = excluded.invited_by,
          responded_at = null,
          updated_at = now();

    insert into public.shared_calendar_notifications (
      calendar_id,
      recipient_id,
      actor_id,
      kind,
      title,
      body,
      payload_json
    )
    select
      v_calendar_id,
      participant.user_id,
      v_uid,
      'calendar_invite',
      v_title,
      format('You were invited to join %s.', v_title),
      jsonb_build_object(
        'notification_kind', 'calendar_invite',
        'calendar_id', v_calendar_id::text,
        'calendar_name', v_title,
        'calendar_color', 5099745,
        'role', 'editor',
        'source', coalesce(p_context ->> 'source', 'commons_joint_flow')
      )
    from unnest(v_participant_ids) as participant(user_id)
    where participant.user_id <> v_uid;

    v_created := true;
  end if;

  insert into public.shared_calendar_participant_sets (
    calendar_id,
    participant_key,
    participant_user_ids,
    created_by
  )
  values (
    v_calendar_id,
    v_participant_key,
    v_participant_ids,
    v_uid
  )
  on conflict (participant_key)
  do update
    set calendar_id = excluded.calendar_id,
        participant_user_ids = excluded.participant_user_ids,
        updated_at = now();

  return jsonb_build_object(
    'calendar_id', v_calendar_id::text,
    'created_calendar', v_created,
    'reused_calendar', not v_created,
    'participant_user_ids', to_jsonb(v_participant_ids)
  );
end;
$$;

revoke all on function public.find_or_create_shared_calendar_for_participants(uuid[], text, jsonb)
from public;
grant execute on function public.find_or_create_shared_calendar_for_participants(uuid[], text, jsonb)
to authenticated;

create or replace function public.create_joint_flow_experience_from_commons(
  p_source_flow_id bigint,
  p_participant_user_ids uuid[],
  p_calendar_title text default null,
  p_client_request_id uuid default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing_result jsonb;
  v_calendar_result jsonb;
  v_calendar_id uuid;
  v_created_calendar boolean := false;
  v_reused_calendar boolean := false;
  v_participant_ids uuid[];
  v_source_flow public.flows%rowtype;
  v_flow_id bigint;
  v_created_flow boolean := false;
  v_room_id uuid;
  v_target_start date;
  v_first_source_date date;
  v_day_delta integer := 0;
  v_total_steps integer := 0;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if coalesce(p_source_flow_id, 0) <= 0 then
    raise exception 'SOURCE_FLOW_REQUIRED';
  end if;

  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('joint_flow_experience:' || v_uid::text || ':' || p_client_request_id::text)
    );

    select result
      into v_existing_result
    from public.joint_flow_experience_requests
    where actor_id = v_uid
      and client_request_id = p_client_request_id;

    if v_existing_result is not null then
      return v_existing_result;
    end if;
  end if;

  v_calendar_result := public.find_or_create_shared_calendar_for_participants(
    p_participant_user_ids,
    p_calendar_title,
    coalesce(p_context, '{}'::jsonb) ||
      jsonb_build_object('source', 'commons_joint_flow')
  );
  v_calendar_id := (v_calendar_result ->> 'calendar_id')::uuid;
  v_created_calendar := coalesce((v_calendar_result ->> 'created_calendar')::boolean, false);
  v_reused_calendar := coalesce((v_calendar_result ->> 'reused_calendar')::boolean, false);

  select array_agg(value::uuid order by value)
    into v_participant_ids
  from jsonb_array_elements_text(v_calendar_result -> 'participant_user_ids') as participant(value);

  select *
    into v_source_flow
  from public.flows f
  where f.id = p_source_flow_id
    and (
      f.user_id = v_uid
      or exists (
        select 1
        from public.flow_posts fp
        where fp.flow_id = f.id
          and coalesce(fp.is_hidden, false) = false
      )
      or exists (
        select 1
        from public.shared_calendar_members scm
        join public.shared_calendars sc
          on sc.id = scm.calendar_id
        where scm.calendar_id = f.calendar_id
          and scm.user_id = v_uid
          and scm.status = 'accepted'
          and sc.deleted_at is null
      )
    )
  limit 1;

  if not found then
    raise exception 'SOURCE_FLOW_NOT_VISIBLE';
  end if;

  begin
    v_target_start := nullif(btrim(coalesce(p_context ->> 'start_date', '')), '')::date;
  exception when others then
    v_target_start := null;
  end;
  v_target_start := coalesce(v_target_start, v_source_flow.start_date, current_date);

  select
    min((ue.starts_at at time zone coalesce(nullif(public._get_user_timezone(coalesce(v_source_flow.user_id, v_uid)), ''), 'UTC'))::date),
    count(*)::integer
    into v_first_source_date, v_total_steps
  from public.user_events ue
  where (
      ue.user_id = v_source_flow.user_id
      or (
        v_source_flow.calendar_id is not null
        and ue.calendar_id = v_source_flow.calendar_id
      )
    )
    and public.user_event_matches_flow(
      v_source_flow.id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail,
      ue.action_id,
      v_source_flow.ai_metadata
    )
    and coalesce(ue.category, '') <> 'tombstone';

  if v_first_source_date is not null then
    v_day_delta := v_target_start - v_first_source_date;
  end if;

  select f.id
    into v_flow_id
  from public.flows f
  where f.calendar_id = v_calendar_id
    and coalesce(f.is_hidden, false) = false
    and (
      f.id = p_source_flow_id
      or f.origin_flow_id = p_source_flow_id
      or f.ai_metadata ->> 'commons_source_flow_id' = p_source_flow_id::text
    )
  order by
    case when f.id = p_source_flow_id then 0 else 1 end,
    f.updated_at desc,
    f.id desc
  limit 1;

  if v_flow_id is null then
    insert into public.flows (
      user_id,
      calendar_id,
      name,
      color,
      active,
      start_date,
      end_date,
      notes,
      rules,
      is_hidden,
      is_reminder,
      is_saved,
      origin_type,
      origin_flow_id,
      root_flow_id,
      ai_metadata
    )
    values (
      v_uid,
      v_calendar_id,
      v_source_flow.name,
      v_source_flow.color,
      true,
      case
        when v_source_flow.start_date is null then v_target_start
        else v_source_flow.start_date + v_day_delta
      end,
      case
        when v_source_flow.end_date is null then null
        else v_source_flow.end_date + v_day_delta
      end,
      v_source_flow.notes,
      coalesce(v_source_flow.rules, '[]'::jsonb),
      false,
      false,
      false,
      'fork',
      v_source_flow.id,
      coalesce(v_source_flow.root_flow_id, v_source_flow.origin_flow_id, v_source_flow.id),
      coalesce(v_source_flow.ai_metadata, '{}'::jsonb) || jsonb_build_object(
        'commons_source_flow_id', v_source_flow.id,
        'commons_joint_calendar_id', v_calendar_id::text
      )
    )
    returning id into v_flow_id;

    v_created_flow := true;
  end if;

  v_room_id := public.ensure_shared_experience_for_flow_internal(
    v_flow_id,
    v_calendar_id,
    v_uid,
    true,
    v_source_flow.id
  );

  with source_events as (
    select
      ue.*,
      row_number() over (order by ue.starts_at asc, ue.created_at asc, ue.id asc) as step_index,
      count(*) over () as step_total
    from public.user_events ue
    where (
        ue.user_id = v_source_flow.user_id
        or (
          v_source_flow.calendar_id is not null
          and ue.calendar_id = v_source_flow.calendar_id
        )
      )
      and public.user_event_matches_flow(
        v_source_flow.id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        v_source_flow.ai_metadata
      )
      and coalesce(ue.category, '') <> 'tombstone'
  )
  insert into public.user_events (
    user_id,
    calendar_id,
    client_event_id,
    title,
    detail,
    location,
    all_day,
    starts_at,
    ends_at,
    flow_local_id,
    category,
    action_id,
    behavior_payload
  )
  select
    v_uid,
    v_calendar_id,
    'joint_flow:' || v_flow_id::text || ':' ||
      md5(coalesce(se.client_event_id, se.id::text)),
    se.title,
    se.detail,
    se.location,
    coalesce(se.all_day, false),
    se.starts_at + (v_day_delta::text || ' days')::interval,
    case
      when se.ends_at is null then null
      else se.ends_at + (v_day_delta::text || ' days')::interval
    end,
    v_flow_id,
    se.category,
    se.action_id,
    coalesce(se.behavior_payload, '{}'::jsonb) || jsonb_build_object(
      'shared_practice_room_id', v_room_id::text,
      'source_flow_id', v_source_flow.id,
      'shared_flow_id', v_flow_id,
      'shared_calendar_id', v_calendar_id::text,
      'source_client_event_id', se.client_event_id,
      'flow_step_index', se.step_index,
      'flow_total_steps', coalesce(nullif(se.step_total, 0), v_total_steps)
    )
  from source_events se
  where not exists (
    select 1
    from public.user_events existing
    where existing.calendar_id = v_calendar_id
      and coalesce(existing.category, '') <> 'tombstone'
      and public.user_event_matches_flow(
        v_flow_id,
        existing.flow_local_id,
        existing.client_event_id,
        existing.detail,
        existing.action_id,
        null
      )
  )
  on conflict (client_event_id) do nothing;

  v_room_id := public.ensure_shared_experience_for_flow_internal(
    v_flow_id,
    v_calendar_id,
    v_uid,
    true,
    v_source_flow.id
  );

  perform public.notify_shared_calendar_members(
    v_calendar_id,
    array_remove(v_participant_ids, v_uid),
    'calendar_event',
    'Joint flow started',
    format('%s was added as a shared flow.', v_source_flow.name),
    jsonb_build_object(
      'notification_kind', 'calendar_event',
      'calendar_id', v_calendar_id::text,
      'flow_id', v_flow_id,
      'shared_practice_room_id', v_room_id::text,
      'source', 'commons_joint_flow'
    )
  );

  v_result := jsonb_build_object(
    'calendar_id', v_calendar_id::text,
    'flow_id', v_flow_id,
    'shared_practice_room_id', v_room_id::text,
    'created_calendar', v_created_calendar,
    'reused_calendar', v_reused_calendar,
    'created_flow', v_created_flow,
    'participant_user_ids', to_jsonb(v_participant_ids)
  );

  if p_client_request_id is not null then
    insert into public.joint_flow_experience_requests (
      actor_id,
      client_request_id,
      result
    )
    values (
      v_uid,
      p_client_request_id,
      v_result
    )
    on conflict (actor_id, client_request_id) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_joint_flow_experience_from_commons(bigint, uuid[], text, uuid, jsonb)
from public;
grant execute on function public.create_joint_flow_experience_from_commons(bigint, uuid[], text, uuid, jsonb)
to authenticated;

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
    where ue.client_event_id = new.client_event_id
      and public.user_event_matches_flow(
        new.flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
      and (
        ue.user_id = new.user_id
        or exists (
          select 1
          from public.shared_calendar_members scm
          join public.shared_calendars sc
            on sc.id = scm.calendar_id
          where scm.calendar_id = ue.calendar_id
            and scm.user_id = new.user_id
            and scm.status = 'accepted'
            and sc.deleted_at is null
        )
      )
  ) then
    raise exception
      'user_event_completions: no matching visible event row for (user_id, client_event_id, flow_id)';
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
    where ue.client_event_id = p_client_event_id
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
      and (
        ue.user_id = v_uid
        or exists (
          select 1
          from public.shared_calendar_members scm
          join public.shared_calendars sc
            on sc.id = scm.calendar_id
          where scm.calendar_id = ue.calendar_id
            and scm.user_id = v_uid
            and scm.status = 'accepted'
            and sc.deleted_at is null
        )
      )
  ) then
    raise exception 'event not found or not visible to current member';
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
    set flow_id = excluded.flow_id,
        completed_on = excluded.completed_on,
        completed_at = excluded.completed_at,
        source = excluded.source;
end;
$$;

comment on function public.record_event_completion(text, bigint, date, text) is
'Validates ownership or accepted shared-calendar membership and upserts a completion keyed by client_event_id + completed_on.';

revoke all on function public.record_event_completion(text, bigint, date, text)
from public;
grant execute on function public.record_event_completion(text, bigint, date, text)
to authenticated;

do $$
declare
  v_flow record;
  v_count integer := 0;
  v_candidate_flow_count integer := 0;
  v_missing_room_count integer := 0;
  v_candidate_event_count integer := 0;
  v_stale_payload_count integer := 0;
  v_cleaned_payload_count integer := 0;
begin
  select count(*)::integer
    into v_candidate_flow_count
  from public.flows f
  join public.shared_calendars sc
    on sc.id = f.calendar_id
  where sc.deleted_at is null
    and sc.is_personal = false
    and coalesce(f.is_hidden, false) = false;

  select count(*)::integer
    into v_missing_room_count
  from public.flows f
  join public.shared_calendars sc
    on sc.id = f.calendar_id
  where sc.deleted_at is null
    and sc.is_personal = false
    and coalesce(f.is_hidden, false) = false
    and not exists (
      select 1
      from public.shared_practice_rooms spr
      where spr.calendar_id = f.calendar_id
        and spr.shared_flow_id = f.id
        and spr.status = 'active'
    );

  select count(*)::integer
    into v_candidate_event_count
  from public.user_events ue
  join public.flows f
    on f.calendar_id = ue.calendar_id
  join public.shared_calendars sc
    on sc.id = f.calendar_id
  where sc.deleted_at is null
    and sc.is_personal = false
    and coalesce(f.is_hidden, false) = false
    and coalesce(ue.category, '') <> 'tombstone'
    and public.user_event_matches_flow(
      f.id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail,
      ue.action_id,
      f.ai_metadata
    );

  raise notice
    'shared experience backfill candidates: flows=%, missing_rooms=%, events_to_stamp=%',
    v_candidate_flow_count,
    v_missing_room_count,
    v_candidate_event_count;

  for v_flow in
    select f.id, f.calendar_id, f.user_id
    from public.flows f
    join public.shared_calendars sc
      on sc.id = f.calendar_id
    where sc.deleted_at is null
      and sc.is_personal = false
      and coalesce(f.is_hidden, false) = false
  loop
    begin
      perform public.ensure_shared_experience_for_flow_internal(
        v_flow.id,
        v_flow.calendar_id,
        v_flow.user_id,
        false
      );
      v_count := v_count + 1;
    exception when others then
      raise warning
        'shared experience backfill skipped for flow %, calendar %: %',
        v_flow.id,
        v_flow.calendar_id,
        sqlerrm;
    end;
  end loop;

  raise notice 'shared experience backfilled % shared-calendar flows', v_count;

  with payload_rows as (
    select
      ue.id,
      ue.calendar_id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail,
      ue.action_id,
      ue.behavior_payload,
      case
        when ue.behavior_payload->>'shared_practice_room_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (ue.behavior_payload->>'shared_practice_room_id')::uuid
        else null
      end as payload_room_id
    from public.user_events ue
    where coalesce(ue.behavior_payload, '{}'::jsonb) ?| array[
      'shared_practice_room_id',
      'shared_practice_entry_id',
      'source_flow_id',
      'shared_flow_id',
      'shared_calendar_id',
      'source_client_event_id',
      'flow_step_index',
      'flow_total_steps'
    ]::text[]
  ),
  stale_payloads as (
    select pr.id
    from payload_rows pr
    left join public.shared_practice_rooms spr
      on spr.id = pr.payload_room_id
     and spr.status = 'active'
    left join public.flows f
      on f.id = spr.shared_flow_id
     and coalesce(f.is_hidden, false) = false
    where pr.payload_room_id is null
       or spr.id is null
       or spr.calendar_id is distinct from pr.calendar_id
       or f.id is null
       or not public.user_event_matches_flow(
         f.id,
         pr.flow_local_id,
         pr.client_event_id,
         pr.detail,
         pr.action_id,
         f.ai_metadata
       )
       or pr.behavior_payload ? 'shared_practice_entry_id'
  )
  select count(*)::integer
    into v_stale_payload_count
  from stale_payloads;

  raise notice
    'shared experience stale payload cleanup candidates: events=%',
    v_stale_payload_count;

  with payload_rows as (
    select
      ue.id,
      ue.calendar_id,
      ue.flow_local_id,
      ue.client_event_id,
      ue.detail,
      ue.action_id,
      ue.behavior_payload,
      case
        when ue.behavior_payload->>'shared_practice_room_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (ue.behavior_payload->>'shared_practice_room_id')::uuid
        else null
      end as payload_room_id
    from public.user_events ue
    where coalesce(ue.behavior_payload, '{}'::jsonb) ?| array[
      'shared_practice_room_id',
      'shared_practice_entry_id',
      'source_flow_id',
      'shared_flow_id',
      'shared_calendar_id',
      'source_client_event_id',
      'flow_step_index',
      'flow_total_steps'
    ]::text[]
  ),
  stale_payloads as (
    select pr.id
    from payload_rows pr
    left join public.shared_practice_rooms spr
      on spr.id = pr.payload_room_id
     and spr.status = 'active'
    left join public.flows f
      on f.id = spr.shared_flow_id
     and coalesce(f.is_hidden, false) = false
    where pr.payload_room_id is null
       or spr.id is null
       or spr.calendar_id is distinct from pr.calendar_id
       or f.id is null
       or not public.user_event_matches_flow(
         f.id,
         pr.flow_local_id,
         pr.client_event_id,
         pr.detail,
         pr.action_id,
         f.ai_metadata
       )
       or pr.behavior_payload ? 'shared_practice_entry_id'
  )
  update public.user_events ue
     set behavior_payload = coalesce(ue.behavior_payload, '{}'::jsonb)
       - 'shared_practice_entry_id'
    from stale_payloads sp
   where ue.id = sp.id;

  get diagnostics v_cleaned_payload_count = row_count;

  raise notice
    'shared experience stale payload cleanup touched % events',
    v_cleaned_payload_count;
end;
$$;
