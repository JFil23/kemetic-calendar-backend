create table if not exists public.reading_house_fragment_replies (
  id uuid primary key default gen_random_uuid(),
  fragment_id uuid not null references public.reading_house_shared_fragments(id)
    on delete cascade,
  calendar_id uuid not null references public.shared_calendars(id)
    on delete cascade,
  flow_id bigint not null references public.flows(id) on delete cascade,
  client_event_id text not null,
  event_number integer,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (btrim(body) <> ''),
  is_host_ack boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists reading_house_fragment_replies_fragment_idx
  on public.reading_house_fragment_replies(fragment_id, created_at asc)
  where deleted_at is null;

create index if not exists reading_house_fragment_replies_sitting_idx
  on public.reading_house_fragment_replies(
    calendar_id,
    flow_id,
    client_event_id,
    created_at asc
  )
  where deleted_at is null;

create index if not exists reading_house_fragment_replies_author_idx
  on public.reading_house_fragment_replies(author_id, created_at desc)
  where deleted_at is null;

drop trigger if exists trg_touch_reading_house_fragment_replies_updated_at
on public.reading_house_fragment_replies;
create trigger trg_touch_reading_house_fragment_replies_updated_at
before update on public.reading_house_fragment_replies
for each row
execute function public.touch_reading_house_shared_fragment_updated_at();

create or replace function public.reading_house_can_read_fragment(
  p_fragment_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reading_house_shared_fragments rhsf
    where rhsf.id = p_fragment_id
      and rhsf.deleted_at is null
      and public.reading_house_is_calendar_member(
        rhsf.calendar_id,
        p_user_id
      )
      and (
        public.reading_house_can_moderate_calendar(
          rhsf.calendar_id,
          p_user_id
        )
        or public.reading_house_has_fragment_unlock(
          rhsf.calendar_id,
          rhsf.flow_id,
          rhsf.client_event_id,
          p_user_id
        )
      )
  );
$$;

alter table public.reading_house_fragment_replies enable row level security;

drop policy if exists reading_house_fragment_replies_select_parent_visible
on public.reading_house_fragment_replies;
create policy reading_house_fragment_replies_select_parent_visible
on public.reading_house_fragment_replies
for select
using (
  deleted_at is null
  and public.reading_house_can_read_fragment(fragment_id)
);

create or replace function public.create_reading_house_fragment_reply(
  p_fragment_id uuid,
  p_body text,
  p_is_host_ack boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fragment public.reading_house_shared_fragments%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_is_host_ack boolean := coalesce(p_is_host_ack, false);
  v_reply_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_fragment_id is null then
    raise exception 'FRAGMENT_REQUIRED';
  end if;

  if v_body = '' then
    raise exception 'REPLY_REQUIRED';
  end if;

  select *
    into v_fragment
  from public.reading_house_shared_fragments
  where id = p_fragment_id;

  if not found or v_fragment.deleted_at is not null then
    raise exception 'FRAGMENT_NOT_FOUND';
  end if;

  if not public.reading_house_can_read_fragment(p_fragment_id, v_uid) then
    raise exception 'FRAGMENT_NOT_ACCESSIBLE';
  end if;

  if v_is_host_ack
      and not public.reading_house_can_moderate_calendar(
        v_fragment.calendar_id,
        v_uid
      ) then
    raise exception 'ACK_NOT_ALLOWED';
  end if;

  insert into public.reading_house_fragment_replies (
    fragment_id,
    calendar_id,
    flow_id,
    client_event_id,
    event_number,
    author_id,
    body,
    is_host_ack
  )
  values (
    v_fragment.id,
    v_fragment.calendar_id,
    v_fragment.flow_id,
    v_fragment.client_event_id,
    v_fragment.event_number,
    v_uid,
    v_body,
    v_is_host_ack
  )
  returning id into v_reply_id;

  return v_reply_id;
end;
$$;

create or replace function public.delete_reading_house_fragment_reply(
  p_reply_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reply public.reading_house_fragment_replies%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_reply
  from public.reading_house_fragment_replies
  where id = p_reply_id;

  if not found or v_reply.deleted_at is not null then
    return false;
  end if;

  if not public.reading_house_is_calendar_member(v_reply.calendar_id, v_uid) then
    raise exception 'HOUSE_NOT_ACCESSIBLE';
  end if;

  if v_reply.author_id <> v_uid
      and not public.reading_house_can_moderate_calendar(
        v_reply.calendar_id,
        v_uid
      ) then
    raise exception 'REPLY_NOT_EDITABLE';
  end if;

  update public.reading_house_fragment_replies
     set deleted_at = now(),
         updated_at = now()
   where id = v_reply.id;

  return true;
end;
$$;

revoke all on function public.reading_house_can_read_fragment(uuid, uuid)
from public;
grant execute on function public.reading_house_can_read_fragment(uuid, uuid)
to authenticated;

revoke all on function public.create_reading_house_fragment_reply(
  uuid,
  text,
  boolean
) from public;
grant execute on function public.create_reading_house_fragment_reply(
  uuid,
  text,
  boolean
) to authenticated;

revoke all on function public.delete_reading_house_fragment_reply(uuid)
from public;
grant execute on function public.delete_reading_house_fragment_reply(uuid)
to authenticated;

grant select on public.reading_house_fragment_replies to authenticated;

notify pgrst, 'reload schema';
