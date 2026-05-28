-- Add retry metadata to scheduled_notifications for dead-letter handling.

alter table public.scheduled_notifications
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists last_attempt_at timestamp with time zone;
