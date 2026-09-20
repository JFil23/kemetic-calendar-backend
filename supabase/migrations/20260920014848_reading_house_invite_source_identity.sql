-- Persist the safe source identity on the membership row itself. Pending
-- invitees may read their membership, but they must not gain access to the
-- host's complete flow before accepting the invitation.
alter table public.shared_calendar_members
  add column if not exists source_flow_id bigint,
  add column if not exists source_flow_key text,
  add column if not exists source_title text;

comment on column public.shared_calendar_members.source_flow_id is
  'Optional flow that authored this invitation. Set only by the owner-only invite RPC.';
comment on column public.shared_calendar_members.source_flow_key is
  'Safe client-facing flow identity captured when the invitation is created.';
comment on column public.shared_calendar_members.source_title is
  'Safe client-facing source title captured when the invitation is created.';

-- Existing Reading House invitations predate the source snapshot. Backfill
-- them from the owner-visible flow and touch updated_at so open clients receive
-- a Realtime membership update after this migration is applied.
with reading_house_source as (
  select distinct on (flow.calendar_id)
    flow.calendar_id,
    flow.id as source_flow_id,
    'the-reading-house'::text as source_flow_key,
    coalesce(
      nullif(btrim(flow.ai_metadata #>> '{reading_house,book_title}'), ''),
      nullif(btrim(calendar.name), ''),
      'Reading House'
    ) as source_title
  from public.flows flow
  join public.shared_calendars calendar
    on calendar.id = flow.calendar_id
   and calendar.deleted_at is null
  where flow.calendar_id is not null
    and (
      flow.ai_metadata ->> 'flow_key' = 'the-reading-house'
      or coalesce(flow.notes, '') like '%maat=the-reading-house%'
    )
  order by flow.calendar_id, flow.active desc, flow.id desc
)
update public.shared_calendar_members member
   set source_flow_id = source.source_flow_id,
       source_flow_key = source.source_flow_key,
       source_title = source.source_title,
       updated_at = now()
  from reading_house_source source
 where member.calendar_id = source.calendar_id
   and member.status = 'pending'
   and (
     member.source_flow_id is distinct from source.source_flow_id
     or member.source_flow_key is distinct from source.source_flow_key
     or member.source_title is distinct from source.source_title
   );

-- Replace the generic invite RPC with the same owner-only contract plus one
-- optional, server-validated source flow. Older clients may continue to call
-- the three-argument form because the fourth argument has a default.
drop function if exists public.invite_user_to_shared_calendar(uuid, uuid, text);

create function public.invite_user_to_shared_calendar(
  p_calendar_id uuid,
  p_user_id uuid,
  p_role text default 'editor',
  p_source_flow_id bigint default null
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
  v_source_flow_id bigint;
  v_source_flow_key text;
  v_source_title text;
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
    from public.shared_calendar_members member
    join public.shared_calendars calendar
      on calendar.id = member.calendar_id
    where member.calendar_id = p_calendar_id
      and member.user_id = v_actor_id
      and member.status = 'accepted'
      and member.role = 'owner'
      and calendar.owner_id = v_actor_id
      and calendar.deleted_at is null
      and calendar.is_personal = false
  ) then
    raise exception 'CALENDAR_NOT_INVITABLE';
  end if;

  select calendar.name, calendar.color
    into v_calendar_name, v_calendar_color
  from public.shared_calendars calendar
  where calendar.id = p_calendar_id
    and calendar.deleted_at is null;

  if p_source_flow_id is not null then
    select
      flow.id,
      'the-reading-house'::text,
      coalesce(
        nullif(btrim(flow.ai_metadata #>> '{reading_house,book_title}'), ''),
        nullif(btrim(v_calendar_name), ''),
        'Reading House'
      )
      into v_source_flow_id, v_source_flow_key, v_source_title
    from public.flows flow
    where flow.id = p_source_flow_id
      and flow.calendar_id = p_calendar_id
      and flow.user_id = v_actor_id
      and (
        flow.ai_metadata ->> 'flow_key' = 'the-reading-house'
        or coalesce(flow.notes, '') like '%maat=the-reading-house%'
      );

    if v_source_flow_id is null then
      raise exception 'INVALID_INVITE_SOURCE_FLOW';
    end if;
  end if;

  select member.status
    into v_existing_status
  from public.shared_calendar_members member
  where member.calendar_id = p_calendar_id
    and member.user_id = p_user_id;

  if v_existing_status = 'accepted' then
    return;
  end if;

  insert into public.shared_calendar_members (
    calendar_id,
    user_id,
    role,
    status,
    invited_by,
    responded_at,
    source_flow_id,
    source_flow_key,
    source_title
  )
  values (
    p_calendar_id,
    p_user_id,
    v_role,
    'pending',
    v_actor_id,
    null,
    v_source_flow_id,
    v_source_flow_key,
    v_source_title
  )
  on conflict (calendar_id, user_id)
  do update
    set role = excluded.role,
        status = 'pending',
        invited_by = excluded.invited_by,
        responded_at = null,
        source_flow_id = coalesce(
          excluded.source_flow_id,
          shared_calendar_members.source_flow_id
        ),
        source_flow_key = coalesce(
          excluded.source_flow_key,
          shared_calendar_members.source_flow_key
        ),
        source_title = coalesce(
          excluded.source_title,
          shared_calendar_members.source_title
        ),
        updated_at = now();

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
    jsonb_strip_nulls(
      jsonb_build_object(
        'notification_kind', 'calendar_invite',
        'calendar_id', p_calendar_id::text,
        'calendar_name', coalesce(v_calendar_name, ''),
        'calendar_color', v_calendar_color,
        'role', v_role,
        'source_flow_id', v_source_flow_id,
        'source_flow_key', v_source_flow_key,
        'source_title', v_source_title
      )
    )
  );
end;
$$;

revoke all on function public.invite_user_to_shared_calendar(
  uuid,
  uuid,
  text,
  bigint
) from public;
revoke all on function public.invite_user_to_shared_calendar(
  uuid,
  uuid,
  text,
  bigint
) from anon;
grant execute on function public.invite_user_to_shared_calendar(
  uuid,
  uuid,
  text,
  bigint
) to authenticated;
grant execute on function public.invite_user_to_shared_calendar(
  uuid,
  uuid,
  text,
  bigint
) to service_role;

-- Backfill the missing notification signal for pending Reading House invites
-- created before invite notifications and Realtime delivery were repaired.
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
  member.calendar_id,
  member.user_id,
  member.invited_by,
  'calendar_invite',
  coalesce(nullif(btrim(calendar.name), ''), 'Calendar invite'),
  format(
    'You were invited to join %s.',
    coalesce(nullif(btrim(calendar.name), ''), 'this calendar')
  ),
  jsonb_build_object(
    'notification_kind', 'calendar_invite',
    'calendar_id', member.calendar_id::text,
    'calendar_name', coalesce(calendar.name, ''),
    'calendar_color', calendar.color,
    'role', member.role,
    'source_flow_id', member.source_flow_id,
    'source_flow_key', member.source_flow_key,
    'source_title', member.source_title
  )
from public.shared_calendar_members member
join public.shared_calendars calendar
  on calendar.id = member.calendar_id
 and calendar.deleted_at is null
where member.status = 'pending'
  and member.source_flow_key = 'the-reading-house'
  and not exists (
    select 1
    from public.shared_calendar_notifications notification
    where notification.calendar_id = member.calendar_id
      and notification.recipient_id = member.user_id
      and notification.kind = 'calendar_invite'
      and notification.deleted_at is null
  );

-- The client view remains security-invoker. It no longer joins the protected
-- flows table, so authenticated pending invitees receive only the safe source
-- snapshot carried by their own membership row.
create or replace view public.shared_calendar_invite_filing_items_client
with (security_invoker = true) as
select
  member.calendar_id,
  calendar.name as calendar_name,
  calendar.color as calendar_color,
  calendar.icon as calendar_icon,
  calendar.owner_id,
  member.user_id as invitee_id,
  invitee_profile.handle as invitee_handle,
  invitee_profile.display_name as invitee_display_name,
  invitee_profile.avatar_url as invitee_avatar_url,
  member.role,
  member.status,
  member.created_at as invited_at,
  member.updated_at,
  member.responded_at,
  member.invited_by,
  inviter_profile.handle as inviter_handle,
  inviter_profile.display_name as inviter_display_name,
  case
    when member.user_id = auth.uid() then 'incoming'
    when calendar.owner_id = auth.uid() and member.user_id <> auth.uid()
      then 'sent'
    else 'other'
  end as invite_direction,
  'calendar_invite'::text as item_kind,
  member.status as lifecycle,
  (calendar.deleted_at is null and member.status = 'pending') as is_pending,
  jsonb_build_object(
    'item_kind', 'calendar_invite',
    'lifecycle', member.status,
    'direction', case
      when member.user_id = auth.uid() then 'incoming'
      when calendar.owner_id = auth.uid() and member.user_id <> auth.uid()
        then 'sent'
      else 'other'
    end,
    'calendar', jsonb_build_object(
      'calendar_id', calendar.id,
      'calendar_name', calendar.name,
      'calendar_color', calendar.color,
      'owner_id', calendar.owner_id
    ),
    'membership', jsonb_build_object(
      'role', member.role,
      'status', member.status,
      'invited_by', member.invited_by,
      'invitee_id', member.user_id
    ),
    'source_flow', jsonb_build_object(
      'flow_id', member.source_flow_id,
      'flow_key', member.source_flow_key,
      'book_title', member.source_title
    )
  ) as filing_reasons,
  member.source_flow_id,
  member.source_flow_key,
  member.source_title as source_book_title
from public.shared_calendar_members member
join public.shared_calendars calendar
  on calendar.id = member.calendar_id
left join public.profiles inviter_profile
  on inviter_profile.id = member.invited_by
left join public.profiles invitee_profile
  on invitee_profile.id = member.user_id
where calendar.deleted_at is null
  and member.status = 'pending'
  and (
    member.user_id = auth.uid()
    or (
      calendar.owner_id = auth.uid()
      and member.user_id <> auth.uid()
    )
  );

revoke all on public.shared_calendar_invite_filing_items_client from public;
revoke all on public.shared_calendar_invite_filing_items_client from anon;
revoke all on public.shared_calendar_invite_filing_items_client
from authenticated;
grant select on public.shared_calendar_invite_filing_items_client
to authenticated;
grant select on public.shared_calendar_invite_filing_items_client
to service_role;

comment on view public.shared_calendar_invite_filing_items_client is
  'Client-safe pending calendar invites. Source identity is an owner-validated membership snapshot, so pending invitees do not need access to host flows.';

notify pgrst, 'reload schema';
