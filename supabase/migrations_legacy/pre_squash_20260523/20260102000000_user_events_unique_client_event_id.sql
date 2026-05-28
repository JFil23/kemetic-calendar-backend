-- Enforce one row per user + client_event_id to prevent reminder duplication across devices.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'user_events_user_client_event_id_uidx'
  ) THEN
    CREATE UNIQUE INDEX user_events_user_client_event_id_uidx
    ON public.user_events (user_id, client_event_id);
  END IF;
END$$;
