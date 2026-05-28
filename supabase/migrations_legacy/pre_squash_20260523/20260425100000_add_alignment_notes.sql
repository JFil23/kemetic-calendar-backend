-- Alignment notes for Planner (affirmations), synced across devices.
-- Safe to run multiple times: guarded by table existence.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'alignment_notes'
  ) THEN
    CREATE TABLE public.alignment_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      body text NOT NULL,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX alignment_notes_user_created_idx
      ON public.alignment_notes (user_id, position, created_at);

    ALTER TABLE public.alignment_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY alignment_notes_owner
      ON public.alignment_notes
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    CREATE TRIGGER trg_touch_alignment_notes
      BEFORE UPDATE ON public.alignment_notes
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;
