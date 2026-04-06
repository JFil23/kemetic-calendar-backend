-- Improve standalone event range scans used by the mobile calendar loader.
-- Targets queries filtered by user_id with flow_local_id IS NULL ordered by starts_at.
CREATE INDEX IF NOT EXISTS idx_user_events_user_flownull_starts
  ON public.user_events USING btree (user_id, starts_at)
  WHERE flow_local_id IS NULL;
