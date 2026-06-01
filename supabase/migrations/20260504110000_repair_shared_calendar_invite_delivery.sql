create table if not exists public.shared_calendar_notifications (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('calendar_invite', 'calendar_event')),
  title text not null,
  body text,
  payload_json jsonb not null default '{}'::jsonb,
  viewed_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.flow_shares
  add column if not exists deleted_at timestamp with time zone;

alter table public.event_shares
  add column if not exists deleted_at timestamp with time zone,
  add column if not exists response_status text not null default 'no_response',
  add column if not exists responded_at timestamp with time zone;

alter table public.event_shares
  drop constraint if exists event_shares_response_status_check;

alter table public.event_shares
  add constraint event_shares_response_status_check
    check (
      response_status = any (
        array[
          'no_response'::text,
          'accepted'::text,
          'declined'::text,
          'maybe'::text
        ]
      )
    );

create index if not exists idx_shared_calendar_notifications_recipient_created
  on public.shared_calendar_notifications (recipient_id, created_at desc);

create index if not exists idx_shared_calendar_notifications_recipient_unread
  on public.shared_calendar_notifications (
    recipient_id,
    viewed_at,
    deleted_at,
    created_at desc
  );

alter table public.shared_calendar_notifications enable row level security;

drop policy if exists "shared_calendar_notifications_select_own"
  on public.shared_calendar_notifications;
create policy "shared_calendar_notifications_select_own"
  on public.shared_calendar_notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "shared_calendar_notifications_update_own"
  on public.shared_calendar_notifications;
create policy "shared_calendar_notifications_update_own"
  on public.shared_calendar_notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

grant select on public.shared_calendar_notifications to authenticated;
grant update (viewed_at, deleted_at) on public.shared_calendar_notifications
  to authenticated;

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
      and scm.role in ('owner', 'editor')
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

insert into public.shared_calendar_notifications (
  calendar_id,
  recipient_id,
  actor_id,
  kind,
  title,
  body,
  payload_json,
  created_at,
  updated_at
)
select
  scm.calendar_id,
  scm.user_id,
  coalesce(scm.invited_by, sc.owner_id),
  'calendar_invite',
  coalesce(nullif(btrim(sc.name), ''), 'Calendar invite'),
  format(
    'You were invited to join %s.',
    coalesce(nullif(btrim(sc.name), ''), 'this calendar')
  ),
  jsonb_build_object(
    'notification_kind', 'calendar_invite',
    'calendar_id', scm.calendar_id::text,
    'calendar_name', coalesce(sc.name, ''),
    'calendar_color', sc.color,
    'role', scm.role
  ),
  scm.created_at,
  now()
from public.shared_calendar_members scm
join public.shared_calendars sc
  on sc.id = scm.calendar_id
where scm.status = 'pending'
  and sc.deleted_at is null
  and coalesce(scm.invited_by, sc.owner_id) is not null
  and coalesce(scm.invited_by, sc.owner_id) <> scm.user_id
  and not exists (
    select 1
    from public.shared_calendar_notifications scn
    where scn.calendar_id = scm.calendar_id
      and scn.recipient_id = scm.user_id
      and scn.kind = 'calendar_invite'
      and scn.deleted_at is null
      and coalesce(
        nullif(
          btrim(
            coalesce(
              scn.payload_json ->> 'notification_kind',
              scn.payload_json ->> 'calendar_kind',
              scn.kind
            )
          ),
          ''
        ),
        scn.kind
      ) = 'calendar_invite'
  );

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
         updated_at = now(),
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

grant execute on function public.respond_to_shared_calendar_invite(uuid, boolean)
  to authenticated;

drop view if exists public.inbox_unread_count_filtered;
drop view if exists public.inbox_share_items_filtered;

create view public.inbox_share_items_filtered
with (security_invoker = true) as
select
  fs.id::text as share_id,
  'flow'::text as kind,
  fs.recipient_id,
  fs.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  fs.id::text as payload_id,
  coalesce((fs.payload_json ->> 'name'::text), ''::text) as title,
  (fs.flow_id)::text as original_flow_id,
  fs.created_at,
  fs.viewed_at,
  fs.imported_at,
  fs.deleted_at,
  fs.suggested_schedule,
  null::text as event_date,
  fs.payload_json,
  null::text as response_status,
  null::timestamp with time zone as responded_at
from public.flow_shares fs
left join public.profiles s on fs.sender_id = s.id
left join public.profiles r on fs.recipient_id = r.id
where fs.recipient_id is not null
  and fs.status = any (array['sent'::text, 'viewed'::text, 'imported'::text])
  and fs.deleted_at is null
union all
select
  es.id::text as share_id,
  'event'::text as kind,
  es.recipient_id,
  es.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  es.id::text as payload_id,
  coalesce(
    es.payload_json ->> 'title',
    es.payload_json ->> 'name',
    ''::text
  ) as title,
  null::text as original_flow_id,
  es.created_at,
  es.viewed_at,
  es.imported_at,
  es.deleted_at,
  null::jsonb as suggested_schedule,
  es.payload_json ->> 'starts_at' as event_date,
  es.payload_json,
  es.response_status,
  es.responded_at
from public.event_shares es
left join public.profiles s on es.sender_id = s.id
left join public.profiles r on es.recipient_id = r.id
where es.recipient_id is not null
  and es.status = any (array['sent'::text, 'viewed'::text, 'imported'::text])
  and es.deleted_at is null
union all
select
  scn.id::text as share_id,
  'calendar'::text as kind,
  scn.recipient_id,
  scn.actor_id as sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  scn.calendar_id::text as payload_id,
  coalesce(nullif(btrim(scn.title), ''), 'Calendar update') as title,
  null::text as original_flow_id,
  scn.created_at,
  scn.viewed_at,
  null::timestamp with time zone as imported_at,
  scn.deleted_at,
  null::jsonb as suggested_schedule,
  scn.payload_json ->> 'starts_at' as event_date,
  coalesce(scn.payload_json, '{}'::jsonb) || jsonb_build_object(
    'notification_kind',
    coalesce(
      nullif(
        btrim(
          coalesce(
            scn.payload_json ->> 'notification_kind',
            scn.payload_json ->> 'calendar_kind',
            scn.kind
          )
        ),
        ''
      ),
      scn.kind
    ),
    'calendar_id',
    scn.calendar_id::text,
    'body',
    scn.body
  ) as payload_json,
  null::text as response_status,
  null::timestamp with time zone as responded_at
from public.shared_calendar_notifications scn
left join public.profiles s on scn.actor_id = s.id
left join public.profiles r on scn.recipient_id = r.id
where scn.deleted_at is null;

create view public.inbox_unread_count_filtered
with (security_invoker = true) as
select count(*) as count
from public.inbox_share_items_filtered
where viewed_at is null
  and deleted_at is null;

grant select on public.inbox_share_items_filtered to authenticated;
grant select on public.inbox_unread_count_filtered to authenticated;

notify pgrst, 'reload schema';
