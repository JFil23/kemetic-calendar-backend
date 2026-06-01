create or replace function public.can_view_shared_calendar_member_row(
  p_calendar_id uuid,
  p_member_status text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_calendars sc
    where sc.id = p_calendar_id
      and sc.deleted_at is null
      and (
        sc.owner_id = auth.uid()
        or (
          p_member_status = 'accepted'
          and exists (
            select 1
            from public.shared_calendar_members self_scm
            where self_scm.calendar_id = p_calendar_id
              and self_scm.user_id = auth.uid()
              and self_scm.status = 'accepted'
          )
        )
      )
  );
$$;

grant execute on function public.can_view_shared_calendar_member_row(uuid, text)
  to authenticated;

drop policy if exists shared_calendar_members_select_visible
  on public.shared_calendar_members;

create policy shared_calendar_members_select_visible
on public.shared_calendar_members
for select
using (
  user_id = auth.uid()
  or public.can_view_shared_calendar_member_row(calendar_id, status)
);

create or replace function public.invite_user_to_shared_calendar(
  p_calendar_id uuid,
  p_user_id uuid,
  p_role text default 'editor'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role text := coalesce(nullif(btrim(p_role), ''), 'editor');
  v_existing_status text;
  v_calendar_name text;
  v_calendar_color bigint;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'INVITEE_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_INVITE_SELF';
  end if;

  if v_role not in ('editor', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_INVITABLE';
  end if;

  select scm.status
    into v_existing_status
  from public.shared_calendar_members scm
  where scm.calendar_id = p_calendar_id
    and scm.user_id = p_user_id;

  if v_existing_status = 'accepted' then
    return;
  end if;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at
  )
  values (
    p_calendar_id,
    p_user_id,
    v_role,
    'pending',
    v_actor_id,
    null
  )
  on conflict (calendar_id, user_id)
  do update
    set role = excluded.role,
        status = 'pending',
        invited_by = excluded.invited_by,
        responded_at = null,
        updated_at = now();

  select sc.name, sc.color
    into v_calendar_name, v_calendar_color
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  update public.shared_calendar_notifications
     set deleted_at = now(),
         updated_at = now()
   where recipient_id = p_user_id
     and calendar_id = p_calendar_id
     and kind = 'calendar_invite'
     and deleted_at is null;

  insert into public.shared_calendar_notifications (
    calendar_id,
    recipient_id,
    actor_id,
    kind,
    title,
    body,
    payload_json
  )
  values (
    p_calendar_id,
    p_user_id,
    v_actor_id,
    'calendar_invite',
    coalesce(nullif(btrim(v_calendar_name), ''), 'Calendar invite'),
    format(
      'You were invited to join %s.',
      coalesce(nullif(btrim(v_calendar_name), ''), 'this calendar')
    ),
    jsonb_build_object(
      'notification_kind', 'calendar_invite',
      'calendar_id', p_calendar_id::text,
      'calendar_name', coalesce(v_calendar_name, ''),
      'calendar_color', v_calendar_color,
      'role', v_role
    )
  );
end;
$$;

grant execute on function public.invite_user_to_shared_calendar(uuid, uuid, text)
  to authenticated;

create or replace function public.list_shared_calendar_members(
  p_calendar_id uuid
)
returns table (
  user_id uuid,
  role text,
  status text,
  invited_by uuid,
  invited_at timestamp with time zone,
  responded_at timestamp with time zone,
  updated_at timestamp with time zone,
  handle text,
  display_name text,
  avatar_url text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_is_owner boolean;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select sc.owner_id = v_actor_id
    into v_is_owner
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null
    and sc.is_personal = false;

  if v_is_owner is null then
    raise exception 'CALENDAR_NOT_FOUND';
  end if;

  if not v_is_owner and not exists (
    select 1
    from public.shared_calendar_members scm
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
  ) then
    raise exception 'CALENDAR_NOT_ACCESSIBLE';
  end if;

  return query
  select
    scm.user_id,
    scm.role,
    scm.status,
    scm.invited_by,
    scm.created_at as invited_at,
    scm.responded_at,
    scm.updated_at,
    p.handle,
    p.display_name,
    p.avatar_url
  from public.shared_calendar_members scm
  left join public.profiles p
    on p.id = scm.user_id
  where scm.calendar_id = p_calendar_id
    and (
      scm.status = 'accepted'
      or (v_is_owner and scm.status = 'pending')
    )
  order by
    case scm.status
      when 'accepted' then 0
      when 'pending' then 1
      else 2
    end,
    case scm.role
      when 'owner' then 0
      when 'editor' then 1
      when 'viewer' then 2
      else 3
    end,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.handle), ''), scm.user_id::text);
end;
$$;

grant execute on function public.list_shared_calendar_members(uuid)
  to authenticated;

create or replace function public.update_shared_calendar_member_role(
  p_calendar_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role text := coalesce(nullif(btrim(p_role), ''), '');
  v_status text;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_CHANGE_SELF';
  end if;

  if v_role not in ('editor', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_MANAGEABLE';
  end if;

  update public.shared_calendar_members scm
     set role = v_role,
         updated_at = now()
   where scm.calendar_id = p_calendar_id
     and scm.user_id = p_user_id
     and scm.status in ('accepted', 'pending')
     and scm.role <> 'owner'
  returning scm.status
    into v_status;

  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_status = 'pending' then
    update public.shared_calendar_notifications scn
       set payload_json = jsonb_set(
             coalesce(scn.payload_json, '{}'::jsonb),
             '{role}',
             to_jsonb(v_role),
             true
           ),
           updated_at = now()
     where scn.calendar_id = p_calendar_id
       and scn.recipient_id = p_user_id
       and scn.kind = 'calendar_invite'
       and scn.deleted_at is null;
  end if;
end;
$$;

grant execute on function public.update_shared_calendar_member_role(uuid, uuid, text)
  to authenticated;

create or replace function public.remove_shared_calendar_member(
  p_calendar_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_REMOVE_SELF';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_MANAGEABLE';
  end if;

  delete from public.shared_calendar_members scm
   where scm.calendar_id = p_calendar_id
     and scm.user_id = p_user_id
     and scm.status = 'accepted'
     and scm.role <> 'owner';

  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;
end;
$$;

grant execute on function public.remove_shared_calendar_member(uuid, uuid)
  to authenticated;

create or replace function public.revoke_shared_calendar_invite(
  p_calendar_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id is null then
    raise exception 'INVITEE_REQUIRED';
  end if;

  if p_user_id = v_actor_id then
    raise exception 'CANNOT_REVOKE_SELF';
  end if;

  if not exists (
    select 1
    from public.shared_calendar_members scm
    join public.shared_calendars sc
      on sc.id = scm.calendar_id
    where scm.calendar_id = p_calendar_id
      and scm.user_id = v_actor_id
      and scm.status = 'accepted'
      and scm.role = 'owner'
      and sc.owner_id = v_actor_id
      and sc.deleted_at is null
      and sc.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_MANAGEABLE';
  end if;

  delete from public.shared_calendar_members scm
   where scm.calendar_id = p_calendar_id
     and scm.user_id = p_user_id
     and scm.status = 'pending'
     and scm.role <> 'owner';

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  update public.shared_calendar_notifications scn
     set deleted_at = now(),
         updated_at = now()
   where scn.calendar_id = p_calendar_id
     and scn.recipient_id = p_user_id
     and scn.kind = 'calendar_invite'
     and scn.deleted_at is null;
end;
$$;

grant execute on function public.revoke_shared_calendar_invite(uuid, uuid)
  to authenticated;

create or replace view public.shared_calendar_filing_items_client
with (security_invoker = true) as
with calendar_event_counts as (
  select
    e.calendar_id,
    count(*) as total_event_count,
    count(*) filter (where e.live_on_calendar) as live_event_count,
    count(*) filter (where e.lifecycle = 'inactive') as inactive_event_count,
    count(distinct e.filed_flow_id) filter (
      where e.filed_flow_id is not null
        and e.live_on_calendar
    ) as live_flow_count
  from public.user_event_filing_items_client e
  where e.calendar_id is not null
  group by e.calendar_id
)
select
  sc.id,
  sc.owner_id,
  sc.name,
  sc.color,
  sc.icon,
  sc.is_personal,
  sc.created_at,
  sc.updated_at,
  scm.user_id as member_user_id,
  scm.role,
  scm.status,
  owner_profile.handle as owner_handle,
  owner_profile.display_name as owner_display_name,
  (
    select count(*)::int
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'accepted'
  ) as member_count,
  case
    when sc.owner_id = auth.uid() then (
      select count(*)::int
      from public.shared_calendar_members inner_scm
      where inner_scm.calendar_id = sc.id
        and inner_scm.status = 'pending'
    )
    else 0
  end as pending_invite_count,
  coalesce(cec.total_event_count, 0) as total_event_count,
  coalesce(cec.live_event_count, 0) as live_event_count,
  coalesce(cec.inactive_event_count, 0) as inactive_event_count,
  coalesce(cec.live_flow_count, 0) as live_flow_count,
  'shared_calendar'::text as item_kind,
  case
    when sc.deleted_at is not null then 'deleted'
    when scm.status = 'accepted' then 'active'
    else scm.status
  end as lifecycle,
  (scm.status = 'accepted' and sc.deleted_at is null) as live_on_calendar,
  (sc.is_personal = false) as is_shared,
  jsonb_build_object(
    'item_kind', 'shared_calendar',
    'lifecycle', case
      when sc.deleted_at is not null then 'deleted'
      when scm.status = 'accepted' then 'active'
      else scm.status
    end,
    'membership', jsonb_build_object(
      'role', scm.role,
      'status', scm.status,
      'member_user_id', scm.user_id,
      'owner_id', sc.owner_id
    ),
    'event_counts', jsonb_build_object(
      'total', coalesce(cec.total_event_count, 0),
      'live', coalesce(cec.live_event_count, 0),
      'inactive', coalesce(cec.inactive_event_count, 0),
      'live_flows', coalesce(cec.live_flow_count, 0)
    )
  ) as filing_reasons
from public.shared_calendars sc
join public.shared_calendar_members scm
  on scm.calendar_id = sc.id
left join public.profiles owner_profile
  on owner_profile.id = sc.owner_id
left join calendar_event_counts cec
  on cec.calendar_id = sc.id
where sc.deleted_at is null
  and scm.user_id = auth.uid()
  and scm.status = 'accepted';

create or replace view public.shared_calendar_invite_filing_items_client
with (security_invoker = true) as
select
  scm.calendar_id,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.icon as calendar_icon,
  sc.owner_id,
  scm.user_id as invitee_id,
  invitee_profile.handle as invitee_handle,
  invitee_profile.display_name as invitee_display_name,
  invitee_profile.avatar_url as invitee_avatar_url,
  scm.role,
  scm.status,
  scm.created_at as invited_at,
  scm.updated_at,
  scm.responded_at,
  scm.invited_by,
  inviter_profile.handle as inviter_handle,
  inviter_profile.display_name as inviter_display_name,
  case
    when scm.user_id = auth.uid() then 'incoming'
    when sc.owner_id = auth.uid() and scm.user_id <> auth.uid() then 'sent'
    else 'other'
  end as invite_direction,
  'calendar_invite'::text as item_kind,
  scm.status as lifecycle,
  (sc.deleted_at is null and scm.status = 'pending') as is_pending,
  jsonb_build_object(
    'item_kind', 'calendar_invite',
    'lifecycle', scm.status,
    'direction', case
      when scm.user_id = auth.uid() then 'incoming'
      when sc.owner_id = auth.uid() and scm.user_id <> auth.uid() then 'sent'
      else 'other'
    end,
    'calendar', jsonb_build_object(
      'calendar_id', sc.id,
      'calendar_name', sc.name,
      'calendar_color', sc.color,
      'owner_id', sc.owner_id
    ),
    'membership', jsonb_build_object(
      'role', scm.role,
      'status', scm.status,
      'invited_by', scm.invited_by,
      'invitee_id', scm.user_id
    )
  ) as filing_reasons
from public.shared_calendar_members scm
join public.shared_calendars sc
  on sc.id = scm.calendar_id
left join public.profiles inviter_profile
  on inviter_profile.id = scm.invited_by
left join public.profiles invitee_profile
  on invitee_profile.id = scm.user_id
where sc.deleted_at is null
  and scm.status = 'pending'
  and (
    scm.user_id = auth.uid()
    or (
      sc.owner_id = auth.uid()
      and scm.user_id <> auth.uid()
    )
  );

create or replace view public.shared_calendar_summaries
with (security_invoker = true) as
select
  sc.id,
  sc.owner_id,
  sc.name,
  sc.color,
  sc.icon,
  sc.is_personal,
  sc.created_at,
  sc.updated_at,
  scm.user_id as member_user_id,
  scm.role,
  scm.status,
  owner_profile.handle as owner_handle,
  owner_profile.display_name as owner_display_name,
  (
    select count(*)::int
    from public.shared_calendar_members inner_scm
    where inner_scm.calendar_id = sc.id
      and inner_scm.status = 'accepted'
  ) as member_count,
  case
    when sc.owner_id = auth.uid() then (
      select count(*)::int
      from public.shared_calendar_members inner_scm
      where inner_scm.calendar_id = sc.id
        and inner_scm.status = 'pending'
    )
    else 0
  end as pending_invite_count
from public.shared_calendars sc
join public.shared_calendar_members scm
  on scm.calendar_id = sc.id
left join public.profiles owner_profile
  on owner_profile.id = sc.owner_id
where sc.deleted_at is null
  and scm.user_id = auth.uid()
  and scm.status = 'accepted';

create or replace view public.shared_calendar_sent_pending_invites
with (security_invoker = true) as
select
  scm.calendar_id,
  sc.name as calendar_name,
  sc.color as calendar_color,
  sc.icon as calendar_icon,
  sc.owner_id,
  scm.user_id as invitee_id,
  invitee_profile.handle as invitee_handle,
  invitee_profile.display_name as invitee_display_name,
  invitee_profile.avatar_url as invitee_avatar_url,
  scm.role,
  scm.status,
  scm.created_at as invited_at,
  scm.invited_by
from public.shared_calendar_members scm
join public.shared_calendars sc
  on sc.id = scm.calendar_id
left join public.profiles invitee_profile
  on invitee_profile.id = scm.user_id
where sc.deleted_at is null
  and sc.owner_id = auth.uid()
  and scm.user_id <> auth.uid()
  and scm.status = 'pending';

revoke all on public.shared_calendar_filing_items_client from public;
revoke all on public.shared_calendar_filing_items_client from anon;
revoke all on public.shared_calendar_filing_items_client from authenticated;
grant select on public.shared_calendar_filing_items_client to authenticated;
grant select on public.shared_calendar_filing_items_client to service_role;

revoke all on public.shared_calendar_invite_filing_items_client from public;
revoke all on public.shared_calendar_invite_filing_items_client from anon;
revoke all on public.shared_calendar_invite_filing_items_client from authenticated;
grant select on public.shared_calendar_invite_filing_items_client to authenticated;
grant select on public.shared_calendar_invite_filing_items_client to service_role;

grant select on public.shared_calendar_summaries to authenticated;
grant select on public.shared_calendar_sent_pending_invites to authenticated;

comment on view public.shared_calendar_filing_items_client is
'Client-safe filing view for accepted calendars. Pending invite counts are owner-only; event counts are derived from user_event_filing_items_client.';

comment on view public.shared_calendar_invite_filing_items_client is
'Client-safe filing view for pending shared calendar invites. Incoming rows are visible to invitees; sent rows are owner-only.';

notify pgrst, 'reload schema';
