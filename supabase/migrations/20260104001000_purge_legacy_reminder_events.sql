-- Optional: purge legacy reminder:* rows from user_events after verifying the new flow-backed reminders path.
-- Uncomment the DELETE below only when you are certain clients no longer rely on reminder:* events.

-- DELETE FROM public.user_events WHERE client_event_id LIKE 'reminder:%';
