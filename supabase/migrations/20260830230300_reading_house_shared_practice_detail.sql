-- Extend the existing room authority with the minimum Reading House detail
-- projection. Generic shared-practice behavior and the existing access gate
-- remain unchanged. Public discovery never grants host editing.

create or replace function public.get_shared_practice_room(
  p_room_id uuid,
  p_local_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.shared_practice_rooms%rowtype;
  v_calendar public.shared_calendars%rowtype;
  v_local_date date := coalesce(p_local_date, current_date);
  v_timezone text;
  v_step jsonb := null;
  v_members jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_join_requests jsonb := '[]'::jsonb;
  v_source_flow jsonb := null;
  v_total_steps integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_room
  from public.shared_practice_rooms
  where id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if not public.shared_practice_can_read_room(v_room.id, v_uid) then
    raise exception 'ROOM_NOT_ACCESSIBLE';
  end if;

  select *
    into v_calendar
  from public.shared_calendars
  where id = v_room.calendar_id
    and deleted_at is null;

  v_timezone := coalesce(nullif(public._get_user_timezone(v_uid), ''), 'UTC');

  select count(*)::integer
    into v_total_steps
  from public.user_events ue
  where ue.calendar_id = v_room.calendar_id
    and ue.behavior_payload ->> 'shared_practice_room_id' = v_room.id::text
    and coalesce(ue.category, '') <> 'tombstone';

  if public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid) then
    select jsonb_build_object(
      'id', ue.id,
      'client_event_id', ue.client_event_id,
      'flow_id', ue.flow_local_id,
      'title', ue.title,
      'detail', ue.detail,
      'starts_at', ue.starts_at,
      'ends_at', ue.ends_at,
      'all_day', ue.all_day,
      'step_index', public.try_parse_bigint(ue.behavior_payload ->> 'flow_step_index'),
      'total_steps', coalesce(
        public.try_parse_bigint(ue.behavior_payload ->> 'flow_total_steps')::integer,
        v_total_steps
      )
    )
      into v_step
    from public.user_events ue
    where ue.calendar_id = v_room.calendar_id
      and ue.behavior_payload ->> 'shared_practice_room_id' = v_room.id::text
      and coalesce(ue.category, '') <> 'tombstone'
      and (ue.starts_at at time zone v_timezone)::date = v_local_date
    order by ue.starts_at asc, ue.created_at asc, ue.id asc
    limit 1;
  end if;

  if public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid) then
    with room_events as (
      select ue.client_event_id
      from public.user_events ue
      where ue.calendar_id = v_room.calendar_id
        and ue.behavior_payload ->> 'shared_practice_room_id' = v_room.id::text
        and coalesce(ue.category, '') <> 'tombstone'
    ),
    today_completion as (
      select
        uec.user_id,
        uec.client_event_id,
        uec.flow_id,
        uec.metadata,
        coalesce(
          nullif(uec.metadata ->> 'completion_status', ''),
          case when uec.id is not null then 'observed' else null end
        ) as completion_status
      from public.user_event_completions uec
      where v_step is not null
        and uec.client_event_id = v_step ->> 'client_event_id'
        and uec.completed_on = v_local_date
    ),
    progress as (
      select
        uec.user_id,
        count(distinct uec.client_event_id)::integer as completed_count
      from public.user_event_completions uec
      join room_events re
        on re.client_event_id = uec.client_event_id
      group by uec.user_id
    ),
    member_rows as (
      select
        scm.user_id,
        scm.role,
        p.handle,
        p.display_name,
        p.avatar_url,
        tc.client_event_id,
        tc.flow_id,
        tc.completion_status,
        coalesce(pr.completed_count, 0) as completed_count,
        spe.id as entry_id,
        spe.visibility as entry_visibility,
        spe.moderation_status as entry_moderation_status,
        nullif(btrim(coalesce(spe.body_text, '')), '') is not null as entry_has_body,
        case
          when spe.id is null then false
          when spe.user_id = v_uid then true
          when spe.moderation_status = 'visible'
            and nullif(btrim(coalesce(spe.body_text, '')), '') is not null
            and (
              spe.visibility = 'shared_with_calendar'
              or (
                spe.visibility = 'public'
                and v_room.visibility = 'public'
              )
            )
          then true
          else false
        end as entry_available_to_viewer,
        exists (
          select 1
          from public.shared_practice_presence spp
          where spp.room_id = v_room.id
            and spp.user_id = scm.user_id
            and spp.opened_on = v_local_date
            and (
              v_step is null
              or spp.client_event_id = v_step ->> 'client_event_id'
            )
        ) as opened_today
      from public.shared_calendar_members scm
      left join public.profiles p
        on p.id = scm.user_id
      left join today_completion tc
        on tc.user_id = scm.user_id
      left join progress pr
        on pr.user_id = scm.user_id
      left join public.shared_practice_entries spe
        on spe.room_id = v_room.id
       and spe.user_id = scm.user_id
       and spe.completed_on = v_local_date
       and (
         v_step is null
         or spe.client_event_id = v_step ->> 'client_event_id'
       )
      where scm.calendar_id = v_room.calendar_id
        and scm.status = 'accepted'
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', user_id,
          'role', role,
          'handle', handle,
          'display_name', display_name,
          'avatar_url', avatar_url,
          'completion_status', completion_status,
          'presence_status', case
            when completion_status is not null then null
            when opened_today then 'carrying'
            else 'not_yet'
          end,
          'completed_count', completed_count,
          'total_count', v_total_steps,
          'entry_id', case
            when entry_available_to_viewer then entry_id
            else null
          end,
          'entry_visibility', case
            when entry_available_to_viewer then entry_visibility
            else null
          end,
          'entry_has_body', case
            when entry_available_to_viewer then entry_has_body
            else false
          end,
          'entry_available_to_viewer', entry_available_to_viewer
        )
        order by
          case role when 'owner' then 0 when 'editor' then 1 else 2 end,
          coalesce(nullif(btrim(display_name), ''), nullif(btrim(handle), ''), user_id::text)
      ),
      '[]'::jsonb
    )
      into v_members
    from member_rows;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', spe.id,
        'room_id', spe.room_id,
        'user_id', spe.user_id,
        'client_event_id', spe.client_event_id,
        'flow_id', spe.flow_id,
        'completed_on', spe.completed_on,
        'completion_status', spe.completion_status,
        'body_text', spe.body_text,
        'visibility', spe.visibility,
        'moderation_status', spe.moderation_status,
        'created_at', spe.created_at,
        'updated_at', spe.updated_at,
        'author_handle', p.handle,
        'author_display_name', p.display_name,
        'author_avatar_url', p.avatar_url
      )
      order by spe.created_at desc
    ),
    '[]'::jsonb
  )
    into v_entries
  from public.shared_practice_entries spe
  left join public.profiles p
    on p.id = spe.user_id
  where spe.room_id = v_room.id
    and spe.completed_on = v_local_date
    and spe.moderation_status = 'visible'
    and nullif(btrim(coalesce(spe.body_text, '')), '') is not null
    and (
      spe.user_id = v_uid
      or (
        public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid)
        and spe.visibility in ('shared_with_calendar', 'public')
      )
      or (
        v_room.visibility = 'public'
        and spe.visibility = 'public'
      )
    );

  if public.shared_practice_can_manage_room(v_room.id, v_uid) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', sprj.id,
          'room_id', sprj.room_id,
          'requester_id', sprj.requester_id,
          'message', sprj.message,
          'status', sprj.status,
          'created_at', sprj.created_at,
          'updated_at', sprj.updated_at,
          'responded_at', sprj.responded_at,
          'requester_handle', p.handle,
          'requester_display_name', p.display_name,
          'requester_avatar_url', p.avatar_url
        )
        order by sprj.created_at asc
      ),
      '[]'::jsonb
    )
      into v_join_requests
    from public.shared_practice_join_requests sprj
    left join public.profiles p
      on p.id = sprj.requester_id
    where sprj.room_id = v_room.id
      and sprj.status = 'pending';
  end if;

  -- Reading House is the only specialized shared-practice presentation.
  -- The existing access check above remains authoritative; this projection is
  -- deliberately limited to the fields that its shared detail page consumes.
  select jsonb_build_object(
      'id', f.id,
      'user_id', f.user_id,
      'calendar_id', f.calendar_id,
      'name', f.name,
      'start_date', f.start_date,
      'end_date', f.end_date,
      'notes', f.notes,
      'ai_metadata', jsonb_strip_nulls(
        jsonb_build_object(
          'flow_key', f.ai_metadata -> 'flow_key',
          'reading_house', f.ai_metadata -> 'reading_house'
        )
      )
    )
    into v_source_flow
  from public.flows f
  where f.id = v_room.source_flow_id
    and (
      v_room.flow_key = 'the-reading-house'
      or f.ai_metadata ->> 'flow_key' = 'the-reading-house'
    );

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'calendar_id', v_room.calendar_id,
      'source_flow_id', v_room.source_flow_id,
      'shared_flow_id', v_room.shared_flow_id,
      'created_by', v_room.created_by,
      'title', v_room.title,
      'description', v_room.description,
      'flow_key', v_room.flow_key,
      'start_date', v_room.start_date,
      'end_date', v_room.end_date,
      'status', v_room.status,
      'visibility', v_room.visibility,
      'join_policy', v_room.join_policy,
      'created_at', v_room.created_at,
      'updated_at', v_room.updated_at
    ),
    'calendar', jsonb_build_object(
      'id', v_calendar.id,
      'owner_id', v_calendar.owner_id,
      'name', v_calendar.name,
      'color', v_calendar.color,
      'icon', v_calendar.icon,
      'is_personal', v_calendar.is_personal
    ),
    'source_flow', v_source_flow,
    'local_date', v_local_date,
    'today_step', v_step,
    'members', v_members,
    'entries', v_entries,
    'join_requests', v_join_requests,
    'viewer_can_edit', v_room.created_by = v_uid,
    'viewer_can_manage', public.shared_practice_can_manage_room(v_room.id, v_uid),
    'viewer_is_member', public.shared_practice_is_calendar_member(v_room.calendar_id, v_uid)
  );
end;
$$;

notify pgrst, 'reload schema';
