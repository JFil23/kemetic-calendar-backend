-- Align scheduled_notifications.notification_type with app enums
-- Adds reminder_10min and flow_step to the allowed values.

alter table public.scheduled_notifications
  drop constraint if exists check_notification_type;

alter table public.scheduled_notifications
  add constraint check_notification_type
    check (notification_type = any (array[
      'event_start',
      'event_end',
      'daily_review',
      'flow_reminder',
      'reminder_10min',
      'flow_step'
    ]));
