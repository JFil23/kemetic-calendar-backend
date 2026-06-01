-- Ka paired Ma'at flow infrastructure.
-- This is intentionally separate from local calendar flow content: completion and
-- visibility depend on both users and on private pair-scoped messages.

create extension if not exists pgcrypto;

create table if not exists public.ka_pairing_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting'
    check (status in ('waiting', 'matched', 'cancelled', 'expired')),
  display_name text,
  epithet text,
  current_state text,
  preferred_send_time time,
  created_at timestamptz not null default now(),
  matched_pair_id uuid
);

create table if not exists public.ka_pairs (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'complete', 'partial', 'closed', 'flagged')),
  starts_on date not null,
  closes_at timestamptz,
  completed_day_count int not null default 0 check (completed_day_count between 0 and 10),
  user_a_formula_spoken boolean not null default false,
  user_b_formula_spoken boolean not null default false,
  ka_formula_spoken boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ka_pairs_distinct_users check (user_a <> user_b)
);

alter table public.ka_pairing_queue
  drop constraint if exists ka_pairing_queue_matched_pair_id_fkey;

alter table public.ka_pairing_queue
  add constraint ka_pairing_queue_matched_pair_id_fkey
  foreign key (matched_pair_id) references public.ka_pairs(id) on delete set null;

create table if not exists public.ka_messages (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.ka_pairs(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  day_number int not null check (day_number between 1 and 10),
  body text not null,
  word_count int not null check (word_count between 1 and 250),
  message_kind text not null check (
    message_kind in (
      'honest_account',
      'witness_response',
      'need_named',
      'gift_given',
      'simultaneous_witness',
      'witness_received',
      'question',
      'answer',
      'change_named',
      'ka_formula'
    )
  ),
  created_at timestamptz not null default now(),
  flagged_at timestamptz,
  deleted_at timestamptz,
  constraint ka_messages_kind_matches_day check (
    (day_number = 1 and message_kind = 'honest_account') or
    (day_number = 2 and message_kind = 'witness_response') or
    (day_number = 3 and message_kind = 'need_named') or
    (day_number = 4 and message_kind = 'gift_given') or
    (day_number = 5 and message_kind = 'simultaneous_witness') or
    (day_number = 6 and message_kind = 'witness_received') or
    (day_number = 7 and message_kind = 'question') or
    (day_number = 8 and message_kind = 'answer') or
    (day_number = 9 and message_kind = 'change_named') or
    (day_number = 10 and message_kind = 'ka_formula')
  ),
  constraint ka_messages_one_per_user_day unique (pair_id, sender_id, day_number)
);

create table if not exists public.ka_flags (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.ka_pairs(id) on delete cascade,
  message_id uuid references public.ka_messages(id) on delete set null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists ka_pairing_queue_waiting_idx
  on public.ka_pairing_queue (status, created_at)
  where status = 'waiting';

create unique index if not exists ka_pairing_queue_one_waiting_user_idx
  on public.ka_pairing_queue (user_id)
  where status = 'waiting';

create index if not exists ka_pairs_user_a_idx on public.ka_pairs (user_a, status);
create index if not exists ka_pairs_user_b_idx on public.ka_pairs (user_b, status);
create index if not exists ka_messages_pair_day_idx on public.ka_messages (pair_id, day_number, created_at);
create index if not exists ka_flags_pair_idx on public.ka_flags (pair_id, created_at desc);

create or replace function public.ka_count_words(p_body text)
returns int
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_body, '')) = '' then 0
    else cardinality(regexp_split_to_array(btrim(p_body), '\s+'))
  end
$$;

create or replace function public.ka_completed_day_count(p_pair_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with pair_users as (
    select user_a, user_b from public.ka_pairs where id = p_pair_id
  ),
  completed_days as (
    select m.day_number
    from public.ka_messages m
    cross join pair_users p
    where m.pair_id = p_pair_id
      and m.deleted_at is null
      and m.sender_id in (p.user_a, p.user_b)
    group by m.day_number
    having count(distinct m.sender_id) = 2
  )
  select count(*)::int from completed_days
$$;

create or replace function public.ka_prepare_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.word_count := public.ka_count_words(new.body);
  if new.word_count < 1 or new.word_count > 250 then
    raise exception 'Ka messages must be between 1 and 250 words'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ka_prepare_message on public.ka_messages;
create trigger trg_ka_prepare_message
before insert or update of body on public.ka_messages
for each row execute function public.ka_prepare_message();

create or replace function public.ka_touch_pair_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ka_pairs p
  set completed_day_count = greatest(
        p.completed_day_count,
        public.ka_completed_day_count(new.pair_id)
      ),
      user_a_formula_spoken = p.user_a_formula_spoken or (
        new.day_number = 10 and
        new.message_kind = 'ka_formula' and
        new.sender_id = p.user_a
      ),
      user_b_formula_spoken = p.user_b_formula_spoken or (
        new.day_number = 10 and
        new.message_kind = 'ka_formula' and
        new.sender_id = p.user_b
      )
  where p.id = new.pair_id;

  update public.ka_pairs
  set status = 'complete',
      ka_formula_spoken = true,
      completed_day_count = 10,
      closes_at = coalesce(closes_at, now() + interval '48 hours')
  where id = new.pair_id
    and user_a_formula_spoken
    and user_b_formula_spoken;

  return new;
end;
$$;

drop trigger if exists trg_ka_touch_pair_completion on public.ka_messages;
create trigger trg_ka_touch_pair_completion
after insert on public.ka_messages
for each row execute function public.ka_touch_pair_completion();

create or replace function public.ka_enter_pairing_queue(
  p_display_name text default null,
  p_epithet text default null,
  p_current_state text default null,
  p_preferred_send_time time default null
)
returns table(queue_id uuid, pair_id uuid, status text, matched boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_waiting public.ka_pairing_queue%rowtype;
  v_queue_id uuid;
  v_pair_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.id into v_pair_id
  from public.ka_pairs p
  where p.status = 'active'
    and (p.user_a = v_user_id or p.user_b = v_user_id)
  order by p.created_at desc
  limit 1;

  if v_pair_id is not null then
    return query select null::uuid, v_pair_id, 'matched'::text, true;
    return;
  end if;

  select q.* into v_waiting
  from public.ka_pairing_queue q
  where q.status = 'waiting'
    and q.user_id <> v_user_id
  order by q.created_at
  for update skip locked
  limit 1;

  if found then
    insert into public.ka_pairs (user_a, user_b, starts_on)
    values (v_waiting.user_id, v_user_id, current_date + 1)
    returning id into v_pair_id;

    insert into public.ka_pairing_queue (
      user_id,
      status,
      display_name,
      epithet,
      current_state,
      preferred_send_time,
      matched_pair_id
    )
    values (
      v_user_id,
      'matched',
      nullif(btrim(p_display_name), ''),
      nullif(btrim(p_epithet), ''),
      nullif(btrim(p_current_state), ''),
      p_preferred_send_time,
      v_pair_id
    )
    returning id into v_queue_id;

    update public.ka_pairing_queue
    set status = 'matched',
        matched_pair_id = v_pair_id
    where id = v_waiting.id;

    return query select v_queue_id, v_pair_id, 'matched'::text, true;
    return;
  end if;

  insert into public.ka_pairing_queue (
    user_id,
    status,
    display_name,
    epithet,
    current_state,
    preferred_send_time
  )
  values (
    v_user_id,
    'waiting',
    nullif(btrim(p_display_name), ''),
    nullif(btrim(p_epithet), ''),
    nullif(btrim(p_current_state), ''),
    p_preferred_send_time
  )
  on conflict (user_id) where status = 'waiting'
  do update set
    display_name = excluded.display_name,
    epithet = excluded.epithet,
    current_state = excluded.current_state,
    preferred_send_time = excluded.preferred_send_time
  returning id into v_queue_id;

  return query select v_queue_id, null::uuid, 'waiting'::text, false;
end;
$$;

create or replace function public.ka_close_pair(p_pair_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ka_pairs
  set status = case when completed_day_count > 0 then 'partial' else 'closed' end,
      closes_at = coalesce(closes_at, now())
  where id = p_pair_id
    and status = 'active'
    and (user_a = auth.uid() or user_b = auth.uid());
end;
$$;

create or replace function public.ka_flag_message(
  p_pair_id uuid,
  p_message_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_flag_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.ka_pairs p
    where p.id = p_pair_id
      and (p.user_a = v_user_id or p.user_b = v_user_id)
  ) then
    raise exception 'Not a participant in this Ka pair' using errcode = '42501';
  end if;

  if p_message_id is not null and not exists (
    select 1 from public.ka_messages m
    where m.id = p_message_id and m.pair_id = p_pair_id
  ) then
    raise exception 'Message does not belong to this Ka pair' using errcode = '42501';
  end if;

  insert into public.ka_flags (pair_id, message_id, reporter_id, reason)
  values (p_pair_id, p_message_id, v_user_id, nullif(btrim(p_reason), ''))
  returning id into v_flag_id;

  update public.ka_messages
  set flagged_at = coalesce(flagged_at, now())
  where id = p_message_id;

  update public.ka_pairs
  set status = 'flagged'
  where id = p_pair_id;

  return v_flag_id;
end;
$$;

alter table public.ka_pairing_queue enable row level security;
alter table public.ka_pairs enable row level security;
alter table public.ka_messages enable row level security;
alter table public.ka_flags enable row level security;

drop policy if exists "Users can view their own Ka queue rows" on public.ka_pairing_queue;
create policy "Users can view their own Ka queue rows"
on public.ka_pairing_queue for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can enter the Ka queue as themselves" on public.ka_pairing_queue;
create policy "Users can enter the Ka queue as themselves"
on public.ka_pairing_queue for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own Ka queue rows" on public.ka_pairing_queue;
create policy "Users can update their own Ka queue rows"
on public.ka_pairing_queue for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Ka pair participants can view pairs" on public.ka_pairs;
create policy "Ka pair participants can view pairs"
on public.ka_pairs for select to authenticated
using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "Ka participants can view visible messages" on public.ka_messages;
create policy "Ka participants can view visible messages"
on public.ka_messages for select to authenticated
using (
  exists (
    select 1
    from public.ka_pairs p
    where p.id = ka_messages.pair_id
      and (p.user_a = auth.uid() or p.user_b = auth.uid())
      and (
        ka_messages.sender_id = auth.uid()
        or ka_messages.day_number <> 5
        or now() >= (p.starts_on::timestamptz + interval '5 days')
        or (
          select count(distinct m.sender_id)
          from public.ka_messages m
          where m.pair_id = ka_messages.pair_id
            and m.day_number = 5
            and m.deleted_at is null
        ) >= 2
      )
  )
);

drop policy if exists "Ka participants can insert active pair messages" on public.ka_messages;
create policy "Ka participants can insert active pair messages"
on public.ka_messages for insert to authenticated
with check (
  auth.uid() = sender_id
  and public.ka_count_words(body) between 1 and 250
  and exists (
    select 1
    from public.ka_pairs p
    where p.id = pair_id
      and p.status = 'active'
      and p.closes_at is null
      and (p.user_a = auth.uid() or p.user_b = auth.uid())
  )
);

drop policy if exists "Ka participants can soft-delete own messages" on public.ka_messages;
create policy "Ka participants can soft-delete own messages"
on public.ka_messages for update to authenticated
using (auth.uid() = sender_id)
with check (auth.uid() = sender_id);

drop policy if exists "Ka flag reporters can view own flags" on public.ka_flags;
create policy "Ka flag reporters can view own flags"
on public.ka_flags for select to authenticated
using (auth.uid() = reporter_id);

drop policy if exists "Ka participants can flag pair messages" on public.ka_flags;
create policy "Ka participants can flag pair messages"
on public.ka_flags for insert to authenticated
with check (
  auth.uid() = reporter_id
  and exists (
    select 1
    from public.ka_pairs p
    where p.id = pair_id
      and (p.user_a = auth.uid() or p.user_b = auth.uid())
  )
);

grant execute on function public.ka_enter_pairing_queue(text, text, text, time) to authenticated;
grant execute on function public.ka_close_pair(uuid) to authenticated;
grant execute on function public.ka_flag_message(uuid, uuid, text) to authenticated;
grant execute on function public.ka_count_words(text) to authenticated, service_role;
grant execute on function public.ka_completed_day_count(uuid) to authenticated, service_role;
