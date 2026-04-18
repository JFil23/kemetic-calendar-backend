-- Allow multiple scheduled notifications per event by notification_type.
-- Also align allowed values with the mobile enum and enforce non-null default.

-- Ensure notification_type always has a value
alter table public.scheduled_notifications
  alter column notification_type set default 'event_start';

update public.scheduled_notifications
  set notification_type = 'event_start'
  where notification_type is null;

alter table public.scheduled_notifications
  alter column notification_type set not null;

-- Refresh allowed notification types
alter table public.scheduled_notifications
  drop constraint if exists check_notification_type;

alter table public.scheduled_notifications
  add constraint check_notification_type
    check (
      notification_type = any (
        array[
          'event_start',
          'event_end',
          'daily_review',
          'flow_reminder',
          'reminder_10min',
          'flow_step'
        ]
      )
    );

-- Replace the uniqueness rule to include notification_type
alter table public.scheduled_notifications
  drop constraint if exists unique_user_client_event;

alter table public.scheduled_notifications
  drop constraint if exists unique_user_client_event_type;

alter table public.scheduled_notifications
  add constraint unique_user_client_event_type unique (user_id, client_event_id, notification_type);
