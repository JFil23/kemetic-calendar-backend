-- Create profile_stats view to surface profile counters
-- Active flows: active = true AND (end_date IS NULL OR end_date >= NOW())
-- Includes imported flows (no share_id exclusion)
CREATE OR REPLACE VIEW public.profile_stats AS
SELECT 
  p.*,
  (
    SELECT COUNT(*) FROM public.flows f
    WHERE f.user_id = p.id
      AND f.active = true
      AND (f.end_date IS NULL OR f.end_date >= NOW())
  ) AS active_flows_count,
  (
    SELECT COUNT(*) FROM public.user_events ue
    WHERE ue.user_id = p.id
      AND ue.flow_local_id IS NOT NULL
  ) AS total_flow_events_count
FROM public.profiles p;

COMMENT ON VIEW public.profile_stats IS 'Profile counters including active_flows_count and total_flow_events_count';
