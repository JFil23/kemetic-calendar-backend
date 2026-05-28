-- Add a unique constraint on flows.reminder_uuid (nullable). Multiple NULLs allowed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.contype = 'u'
      AND t.relname = 'flows'
      AND c.conname = 'flows_reminder_uuid_unique'
  ) THEN
    ALTER TABLE public.flows
      ADD CONSTRAINT flows_reminder_uuid_unique UNIQUE (reminder_uuid);
  END IF;
END$$;
