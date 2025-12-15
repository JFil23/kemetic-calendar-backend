-- Add deleted_at columns and fix inbox views for proper notification handling
-- This migration:
-- 1. Adds deleted_at to flow_shares and event_shares
-- 2. Updates inbox_share_items_filtered to include deleted_at and filter deleted items
-- 3. Fixes inbox_unread_count_filtered to return 'count' (not 'unread_count') and exclude deleted items

-- 1) Add deleted_at to both share tables if missing
ALTER TABLE public.flow_shares
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.event_shares
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2) Update inbox_share_items_filtered to include deleted_at and filter deleted items
-- Also add title fallback using COALESCE for when flow_id is NULL
CREATE OR REPLACE VIEW public.inbox_share_items_filtered AS
SELECT 
  fs.id AS share_id,
  'flow'::text AS kind,
  fs.recipient_id,
  fs.sender_id,
  s.handle        AS sender_handle,
  s.display_name  AS sender_name,
  s.avatar_url    AS sender_avatar,
  r.handle        AS recipient_handle,
  r.display_name  AS recipient_display_name,
  r.avatar_url    AS recipient_avatar_url,
  fs.flow_id::text AS payload_id,
  COALESCE(fs.flow_title, fs.payload_json->>'name') AS title,  -- ✅ title fallback when flow_id is NULL
  fs.created_at,
  fs.viewed_at,
  fs.imported_at,
  fs.deleted_at,           -- ✅ exposed for Flutter models
  fs.suggested_schedule,
  NULL::text AS event_date,
  fs.payload_json
FROM public.flow_shares fs
LEFT JOIN public.profiles s ON fs.sender_id = s.id
LEFT JOIN public.profiles r ON fs.recipient_id = r.id
WHERE fs.recipient_id IS NOT NULL
  AND fs.status IN ('sent', 'viewed', 'imported')
  AND fs.deleted_at IS NULL                        -- ✅ filter deleted items

UNION ALL

SELECT 
  es.id AS share_id,
  'event'::text AS kind,
  es.recipient_id,
  es.sender_id,
  s.handle        AS sender_handle,
  s.display_name  AS sender_name,
  s.avatar_url    AS sender_avatar,
  r.handle        AS recipient_handle,
  r.display_name  AS recipient_display_name,
  r.avatar_url    AS recipient_avatar_url,
  es.event_id::text AS payload_id,
  es.event_title  AS title,
  es.created_at,
  es.viewed_at,
  es.imported_at,
  es.deleted_at,           -- ✅ exposed for Flutter models
  es.suggested_schedule,
  es.event_date,
  NULL::jsonb AS payload_json
FROM public.event_shares es
LEFT JOIN public.profiles s ON es.sender_id = s.id
LEFT JOIN public.profiles r ON es.recipient_id = r.id
WHERE es.recipient_id IS NOT NULL
  AND es.status IN ('sent', 'viewed', 'imported')
  AND es.deleted_at IS NULL;                       -- ✅ filter deleted items

-- 3) Fix unread count view to match Flutter expectations
-- Flutter uses .maybeSingle() expecting one row with 'count' column
CREATE OR REPLACE VIEW public.inbox_unread_count_filtered AS
SELECT 
  COUNT(*) AS count        -- ✅ matches Flutter: `select('count').maybeSingle()`
FROM public.inbox_share_items_filtered
WHERE viewed_at IS NULL
  AND deleted_at IS NULL;  -- ✅ don't count soft-deleted items
  -- RLS on inbox_share_items_filtered ensures we only see rows
  -- where recipient_id = auth.uid(), so we don't need to select/group it here





