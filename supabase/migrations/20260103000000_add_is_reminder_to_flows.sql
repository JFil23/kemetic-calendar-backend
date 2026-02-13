-- Add is_reminder flag to flows to distinguish reminder-backed flows.
ALTER TABLE public.flows
ADD COLUMN IF NOT EXISTS is_reminder boolean NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS flows_is_reminder_idx ON public.flows (is_reminder);
