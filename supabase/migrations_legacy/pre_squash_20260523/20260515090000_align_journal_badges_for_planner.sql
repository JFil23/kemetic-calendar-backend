-- Planner badge mirrors are not always attached to a journal_entries row.
-- They also use deterministic text event ids such as
-- planner-todo:yyyy-MM-dd:<todo-id>, so event_id must not be uuid-only.

ALTER TABLE public.journal_badges
  ALTER COLUMN entry_id DROP NOT NULL;

ALTER TABLE public.journal_badges
  ADD COLUMN IF NOT EXISTS badge_id text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'journal_badges'
      AND column_name = 'event_id'
      AND udt_name = 'uuid'
  ) THEN
    ALTER TABLE public.journal_badges
      ALTER COLUMN event_id TYPE text USING event_id::text;
  END IF;
END $$;

ALTER TABLE public.journal_badges
  ADD COLUMN IF NOT EXISTS event_id text;

CREATE INDEX IF NOT EXISTS idx_journal_badges_user_event_id
  ON public.journal_badges (user_id, event_id)
  WHERE event_id IS NOT NULL;
