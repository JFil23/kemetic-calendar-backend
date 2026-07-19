create table if not exists public.reading_house_chat_messages (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars(id)
    on delete cascade,
  flow_id bigint not null references public.flows(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists reading_house_chat_messages_house_idx
  on public.reading_house_chat_messages(
    calendar_id,
    flow_id,
    created_at asc
  )
  where deleted_at is null;

create index if not exists reading_house_chat_messages_author_idx
  on public.reading_house_chat_messages(author_id, created_at desc)
  where deleted_at is null;

drop trigger if exists trg_touch_reading_house_chat_messages_updated_at
on public.reading_house_chat_messages;
create trigger trg_touch_reading_house_chat_messages_updated_at
before update on public.reading_house_chat_messages
for each row
execute function public.touch_reading_house_shared_fragment_updated_at();

create or replace function public.reading_house_is_solo_study_house(
  p_calendar_id uuid,
  p_flow_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_events ue
    join public.flows f
      on f.id = p_flow_id
    where ue.calendar_id = p_calendar_id
      and coalesce(ue.category, '') <> 'tombstone'
      and public.user_event_matches_flow(
        p_flow_id,
        ue.flow_local_id,
        ue.client_event_id,
        ue.detail,
        ue.action_id,
        f.ai_metadata
      )
      and (
        ue.behavior_payload ->> 'house_mode' = 'solo'
        or coalesce(f.notes, '') like '%reading_house_mode=solo%'
      )
  );
$$;

alter table public.reading_house_chat_messages enable row level security;

drop policy if exists reading_house_chat_messages_select_members
on public.reading_house_chat_messages;
create policy reading_house_chat_messages_select_members
on public.reading_house_chat_messages
for select
using (
  deleted_at is null
  and public.reading_house_is_calendar_member(calendar_id)
  and not public.reading_house_is_solo_study_house(calendar_id, flow_id)
);

create or replace function public.create_reading_house_chat_message(
  p_calendar_id uuid,
  p_flow_id bigint,
  p_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_active_member_count integer := 0;
  v_message_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_calendar_id is null then
    raise exception 'CALENDAR_REQUIRED';
  end if;

  if coalesce(p_flow_id, 0) <= 0 then
    raise exception 'FLOW_REQUIRED';
  end if;

  if v_body = '' then
    raise exception 'CHAT_BODY_REQUIRED';
  end if;

  if not public.reading_house_is_calendar_member(p_calendar_id, v_uid) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if not public.reading_house_flow_on_calendar(p_calendar_id, p_flow_id) then
    raise exception 'HOUSE_NOT_FOUND';
  end if;

  if public.reading_house_is_solo_study_house(p_calendar_id, p_flow_id) then
    raise exception 'CHAT_NOT_AVAILABLE_FOR_SOLO_STUDY';
  end if;

  select count(*)::integer
    into v_active_member_count
  from public.shared_calendar_members scm
  join public.shared_calendars sc
    on sc.id = scm.calendar_id
  where scm.calendar_id = p_calendar_id
    and scm.status = 'accepted'
    and sc.deleted_at is null
    and coalesce(sc.is_personal, false) = false;

  if v_active_member_count < 2 then
    raise exception 'CHAT_OPENS_WHEN_READERS_JOIN';
  end if;

  insert into public.reading_house_chat_messages (
    calendar_id,
    flow_id,
    author_id,
    body
  )
  values (
    p_calendar_id,
    p_flow_id,
    v_uid,
    v_body
  )
  returning id into v_message_id;

  return v_message_id;
end;
$$;

create or replace function public.delete_reading_house_chat_message(
  p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.reading_house_chat_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_message
  from public.reading_house_chat_messages
  where id = p_message_id;

  if not found or v_message.deleted_at is not null then
    return false;
  end if;

  if not public.reading_house_is_calendar_member(v_message.calendar_id, v_uid) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if v_message.author_id <> v_uid
      and not public.reading_house_can_moderate_calendar(
        v_message.calendar_id,
        v_uid
      ) then
    raise exception 'CHAT_MESSAGE_NOT_EDITABLE';
  end if;

  update public.reading_house_chat_messages
     set deleted_at = now(),
         updated_at = now()
   where id = v_message.id;

  return true;
end;
$$;

revoke all on function public.reading_house_is_solo_study_house(uuid, bigint)
from public;
grant execute on function public.reading_house_is_solo_study_house(uuid, bigint)
to authenticated;

revoke all on function public.create_reading_house_chat_message(
  uuid,
  bigint,
  text
) from public;
grant execute on function public.create_reading_house_chat_message(
  uuid,
  bigint,
  text
) to authenticated;

revoke all on function public.delete_reading_house_chat_message(uuid)
from public;
grant execute on function public.delete_reading_house_chat_message(uuid)
to authenticated;

grant select on public.reading_house_chat_messages to authenticated;

notify pgrst, 'reload schema';
