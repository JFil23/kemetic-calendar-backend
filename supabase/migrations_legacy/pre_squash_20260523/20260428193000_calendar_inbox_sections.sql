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
  and scm.invited_by = auth.uid()
  and scm.user_id <> auth.uid()
  and scm.status = 'pending';

grant select on public.shared_calendar_sent_pending_invites to authenticated;

create or replace function public.respond_to_shared_calendar_invite(
  p_calendar_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text := case when p_accept then 'accepted' else 'declined' end;
  v_invited_by uuid;
  v_role text;
  v_calendar_name text;
  v_calendar_color bigint;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.shared_calendar_members scm
     set status = v_status,
         responded_at = now(),
         updated_at = now()
   where scm.calendar_id = p_calendar_id
     and scm.user_id = v_user_id
     and scm.status = 'pending'
  returning scm.invited_by, scm.role
    into v_invited_by, v_role;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  update public.shared_calendar_notifications scn
     set viewed_at = coalesce(scn.viewed_at, now()),
         payload_json = jsonb_set(
           jsonb_set(
             coalesce(scn.payload_json, '{}'::jsonb),
             '{invite_status}',
             to_jsonb(v_status),
             true
           ),
           '{notification_kind}',
           to_jsonb('calendar_invite'),
           true
         )
   where scn.calendar_id = p_calendar_id
     and scn.recipient_id = v_user_id
     and scn.kind = 'calendar_invite'
     and scn.deleted_at is null;

  select sc.name, sc.color
    into v_calendar_name, v_calendar_color
  from public.shared_calendars sc
  where sc.id = p_calendar_id
    and sc.deleted_at is null;

  if v_invited_by is not null and v_invited_by <> v_user_id then
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
      v_invited_by,
      v_user_id,
      'calendar_invite',
      coalesce(nullif(btrim(v_calendar_name), ''), 'Calendar invite'),
      format(
        'Your invitation was %s.',
        case when p_accept then 'accepted' else 'declined' end
      ),
      jsonb_build_object(
        'notification_kind', 'calendar_invite_response',
        'calendar_id', p_calendar_id::text,
        'calendar_name', coalesce(v_calendar_name, ''),
        'calendar_color', v_calendar_color,
        'invite_status', v_status,
        'role', coalesce(v_role, 'editor')
      )
    );
  end if;
end;
$$;

grant execute on function public.respond_to_shared_calendar_invite(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
