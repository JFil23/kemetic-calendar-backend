-- Add optional category tags to user events, journal entries, and flow notes.
-- Categories are stored as plain text (e.g., 'Body', 'Mind', 'Spirit', ...).

-- Events on the calendar
ALTER TABLE IF EXISTS public.user_events
ADD COLUMN IF NOT EXISTS category text;

-- Journal entries (one per greg_date)
ALTER TABLE IF EXISTS public.journal_entries
ADD COLUMN IF NOT EXISTS category text;

-- Flow day notes (if present in the schema)
ALTER TABLE IF EXISTS public.flow_notes
ADD COLUMN IF NOT EXISTS category text;
