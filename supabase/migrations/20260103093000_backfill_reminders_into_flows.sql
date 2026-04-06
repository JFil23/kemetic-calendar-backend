-- Backfill existing reminders into flows as reminder-backed flows.
-- Preconditions:
-- - public.flows has columns is_reminder (boolean) and reminder_uuid (uuid) with the migration applied.
-- - public.reminders is the canonical reminder table (id, user_id, title, alert_at, ...).

-- 1) Insert any reminders that don't have a mapped flow.
insert into public.flows (
  user_id,
  name,
  color,
  active,
  start_date,
  end_date,
  notes,
  rules,
  is_hidden,
  is_reminder,
  reminder_uuid,
  created_at,
  updated_at
)
select
  r.user_id,
  r.title,
  5099745,                    -- default flow color (reminders has no color column)
  true,                       -- active (reminders has no active column)
  (r.alert_at)::date,         -- start_date from alert_at (reminders has no start_local)
  null,                       -- no end date
  to_jsonb(r.*)::text,        -- store full reminder JSON in notes for recovery
  '[]'::jsonb,                -- rules placeholder; reminder recurrence handled client-side
  false,                      -- not hidden
  true,
  r.id,
  now(),
  now()
from public.reminders r
where not exists (
  select 1 from public.flows f
  where f.reminder_uuid = r.id
);

-- 2) Optionally, clean up legacy reminder:* rows from user_events (commented out for safety).
-- Uncomment if you want to purge legacy reminder meta/occurrence events after verifying the migration.
-- delete from public.user_events where client_event_id like 'reminder:%';

-- Note: occurrence regeneration will be handled client-side after this migration.
