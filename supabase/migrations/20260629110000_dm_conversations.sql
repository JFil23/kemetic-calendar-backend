create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'group',
  title text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_message_at timestamptz,
  deleted_at timestamptz,
  constraint dm_conversations_type_check check (type in ('direct', 'group')),
  constraint dm_conversations_title_check check (
    title is null
    or (
      btrim(title) <> ''
      and char_length(title) <= 120
    )
  )
);

create table if not exists public.dm_conversation_members (
  conversation_id uuid not null references public.dm_conversations(id)
    on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default timezone('utc', now()),
  left_at timestamptz,
  muted_at timestamptz,
  archived_at timestamptz,
  last_read_at timestamptz,
  deleted_at timestamptz,
  primary key (conversation_id, user_id),
  constraint dm_conversation_members_role_check check (role in ('owner', 'member'))
);

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id)
    on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  kind text not null default 'text',
  payload_json jsonb,
  client_message_id text,
  created_at timestamptz not null default timezone('utc', now()),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint dm_messages_kind_check check (
    kind in ('text', 'flow_share', 'event_share', 'system')
  ),
  constraint dm_messages_body_check check (
    (
      kind = 'text'
      and body is not null
      and btrim(body) <> ''
      and char_length(body) <= 4000
    )
    or (
      kind <> 'text'
      and (
        body is null
        or char_length(body) <= 4000
      )
    )
  )
);

create table if not exists public.dm_message_reactions (
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'heart',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (message_id, user_id, reaction),
  constraint dm_message_reactions_reaction_check check (
    btrim(reaction) <> ''
    and char_length(reaction) <= 32
  )
);

create index if not exists dm_conversations_updated_idx
  on public.dm_conversations(updated_at desc)
  where deleted_at is null;

create index if not exists dm_conversation_members_user_idx
  on public.dm_conversation_members(user_id, archived_at, deleted_at);

create index if not exists dm_conversation_members_conversation_idx
  on public.dm_conversation_members(conversation_id, deleted_at, left_at);

create index if not exists dm_messages_conversation_created_idx
  on public.dm_messages(conversation_id, created_at asc)
  where deleted_at is null;

create index if not exists dm_messages_sender_created_idx
  on public.dm_messages(sender_id, created_at desc)
  where deleted_at is null;

create unique index if not exists dm_messages_client_message_unique
  on public.dm_messages(conversation_id, sender_id, client_message_id)
  where client_message_id is not null;

create index if not exists dm_message_reactions_message_idx
  on public.dm_message_reactions(message_id, created_at desc);

drop trigger if exists trg_touch_dm_conversations_updated_at
on public.dm_conversations;
create trigger trg_touch_dm_conversations_updated_at
before update on public.dm_conversations
for each row execute function public.touch_updated_at();

create or replace function public.dm_is_conversation_member(
  p_conversation_id uuid,
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
    from public.dm_conversation_members m
    join public.dm_conversations c
      on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id
      and m.user_id = p_user_id
      and m.left_at is null
      and m.deleted_at is null
      and c.deleted_at is null
  );
$$;

alter table public.dm_conversations enable row level security;
alter table public.dm_conversation_members enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_message_reactions enable row level security;

drop policy if exists dm_conversations_select_members
on public.dm_conversations;
create policy dm_conversations_select_members
on public.dm_conversations
for select
to authenticated
using (
  deleted_at is null
  and public.dm_is_conversation_member(id)
);

drop policy if exists dm_conversation_members_select_conversation_members
on public.dm_conversation_members;
create policy dm_conversation_members_select_conversation_members
on public.dm_conversation_members
for select
to authenticated
using (
  public.dm_is_conversation_member(conversation_id)
);

drop policy if exists dm_messages_select_members
on public.dm_messages;
create policy dm_messages_select_members
on public.dm_messages
for select
to authenticated
using (
  deleted_at is null
  and public.dm_is_conversation_member(conversation_id)
);

drop policy if exists dm_message_reactions_select_members
on public.dm_message_reactions;
create policy dm_message_reactions_select_members
on public.dm_message_reactions
for select
to authenticated
using (
  exists (
    select 1
    from public.dm_messages msg
    where msg.id = dm_message_reactions.message_id
      and msg.deleted_at is null
      and public.dm_is_conversation_member(msg.conversation_id)
  )
);

drop policy if exists dm_message_reactions_insert_members
on public.dm_message_reactions;
create policy dm_message_reactions_insert_members
on public.dm_message_reactions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.dm_messages msg
    where msg.id = dm_message_reactions.message_id
      and msg.deleted_at is null
      and public.dm_is_conversation_member(msg.conversation_id)
  )
);

drop policy if exists dm_message_reactions_delete_own
on public.dm_message_reactions;
create policy dm_message_reactions_delete_own
on public.dm_message_reactions
for delete
to authenticated
using (user_id = auth.uid());

create or replace view public.dm_conversation_summaries
with (security_invoker = true) as
select
  c.id as conversation_id,
  c.type,
  c.title,
  c.created_by,
  c.created_at,
  c.updated_at,
  c.last_message_at,
  my_member.last_read_at,
  my_member.muted_at,
  my_member.archived_at,
  my_member.deleted_at as member_deleted_at,
  coalesce(members.members, '[]'::jsonb) as members,
  lm.id as last_message_id,
  lm.sender_id as last_sender_id,
  lm.body as last_body,
  lm.kind as last_kind,
  lm.payload_json as last_payload_json,
  lm.created_at as last_created_at,
  lmp.display_name as last_sender_display_name,
  lmp.handle as last_sender_handle,
  (
    select count(*)::integer
    from public.dm_messages unread
    where unread.conversation_id = c.id
      and unread.deleted_at is null
      and unread.sender_id <> auth.uid()
      and (
        my_member.last_read_at is null
        or unread.created_at > my_member.last_read_at
      )
  ) as unread_count
from public.dm_conversation_members my_member
join public.dm_conversations c
  on c.id = my_member.conversation_id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id,
      'role', m.role,
      'joined_at', m.joined_at,
      'left_at', m.left_at,
      'muted_at', m.muted_at,
      'archived_at', m.archived_at,
      'last_read_at', m.last_read_at,
      'display_name', p.display_name,
      'handle', p.handle,
      'avatar_url', p.avatar_url,
      'avatar_glyphs', p.avatar_glyphs
    )
    order by
      case when m.user_id = c.created_by then 0 else 1 end,
      m.joined_at,
      coalesce(p.display_name, p.handle, m.user_id::text)
  ) as members
  from public.dm_conversation_members m
  join public.profiles p
    on p.id = m.user_id
  where m.conversation_id = c.id
    and m.left_at is null
    and m.deleted_at is null
) members on true
left join lateral (
  select msg.*
  from public.dm_messages msg
  where msg.conversation_id = c.id
    and msg.deleted_at is null
  order by msg.created_at desc
  limit 1
) lm on true
left join public.profiles lmp
  on lmp.id = lm.sender_id
where my_member.user_id = auth.uid()
  and my_member.left_at is null
  and my_member.deleted_at is null
  and c.deleted_at is null;

create or replace view public.dm_conversation_messages_client
with (security_invoker = true) as
select
  msg.id,
  msg.conversation_id,
  msg.sender_id,
  msg.body,
  msg.kind,
  msg.payload_json,
  msg.client_message_id,
  msg.created_at,
  msg.edited_at,
  msg.deleted_at,
  p.display_name as sender_display_name,
  p.handle as sender_handle,
  p.avatar_url as sender_avatar_url,
  p.avatar_glyphs as sender_avatar_glyphs
from public.dm_messages msg
join public.profiles p
  on p.id = msg.sender_id
where msg.deleted_at is null
  and public.dm_is_conversation_member(msg.conversation_id);

revoke all on function public.dm_is_conversation_member(uuid, uuid) from public;
grant execute on function public.dm_is_conversation_member(uuid, uuid)
to authenticated, service_role;

grant select on public.dm_conversations to authenticated;
grant select on public.dm_conversation_members to authenticated;
grant select on public.dm_messages to authenticated;
grant select, insert, delete on public.dm_message_reactions to authenticated;
grant select on public.dm_conversation_summaries to authenticated;
grant select on public.dm_conversation_messages_client to authenticated;
grant all on table public.dm_conversations to service_role;
grant all on table public.dm_conversation_members to service_role;
grant all on table public.dm_messages to service_role;
grant all on table public.dm_message_reactions to service_role;
grant select on public.dm_conversation_summaries to service_role;
grant select on public.dm_conversation_messages_client to service_role;

notify pgrst, 'reload schema';
