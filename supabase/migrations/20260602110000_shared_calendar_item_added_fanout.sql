create table if not exists public.shared_calendar_item_added_fanout (
  dedupe_key text primary key,
  calendar_id uuid not null references public.shared_calendars(id) on delete cascade,
  item_type text not null check (
    item_type = any (array[
      'flow'::text,
      'event'::text,
      'note'::text,
      'reminder'::text,
      'task'::text
    ])
  ),
  item_id text not null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_count integer not null default 0,
  notification_count integer not null default 0,
  push_sent_count integer not null default 0,
  push_failed_count integer not null default 0,
  status text not null default 'created' check (
    status = any (array[
      'created'::text,
      'completed'::text,
      'push_failed'::text
    ])
  ),
  last_error text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone
);

create index if not exists idx_shared_calendar_item_added_fanout_calendar_created
  on public.shared_calendar_item_added_fanout (calendar_id, created_at desc);

create index if not exists idx_shared_calendar_item_added_fanout_actor_created
  on public.shared_calendar_item_added_fanout (actor_user_id, created_at desc);

alter table public.shared_calendar_item_added_fanout enable row level security;

comment on table public.shared_calendar_item_added_fanout is
'Server-side idempotency ledger for push fanout when new calendar-visible items are added to shared calendars. Dedupe key format: shared_calendar_item_added:{calendarId}:{itemType}:{itemId}.';
