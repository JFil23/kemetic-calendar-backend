
-- Ensure unique badge identity per entry + enforce schedule/badge integrity

-- Journal badges: stable identity per entry (only if badge_id column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'journal_badges' AND column_name = 'badge_id'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_badges_user_entry_badge
      ON public.journal_badges (user_id, entry_id, badge_id);
  END IF;
END$$;

-- Decan reflection schedule already has unique (user_id,decan_start); keep for clarity
CREATE UNIQUE INDEX IF NOT EXISTS uq_dec_ref_sched_user_start
  ON public.decan_reflection_schedule (user_id, decan_start);
