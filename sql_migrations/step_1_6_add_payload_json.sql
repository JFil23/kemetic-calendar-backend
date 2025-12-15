-- Step 1.6: Add payload_json column to flow_shares table
-- This allows storing complete flow data + event snapshots in the share

-- Add payload_json column to flow_shares table
ALTER TABLE flow_shares 
ADD COLUMN IF NOT EXISTS payload_json JSONB;

-- Create index for performance (GIN index for JSONB queries)
CREATE INDEX IF NOT EXISTS idx_flow_shares_payload_json 
ON flow_shares USING GIN (payload_json);

-- Update inbox_share_items_filtered view to read payload_json from table
CREATE OR REPLACE VIEW inbox_share_items_filtered AS
SELECT 
  fs.id as share_id,
  'flow' as kind,
  fs.recipient_id,
  fs.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  fs.flow_id::text as payload_id,
  fs.flow_title as title,
  fs.created_at,
  fs.viewed_at,
  fs.imported_at,
  fs.suggested_schedule,
  NULL as event_date,
  fs.payload_json -- ✅ Read from table (includes events[] array)
FROM flow_shares fs
LEFT JOIN profiles s ON fs.sender_id = s.id
LEFT JOIN profiles r ON fs.recipient_id = r.id
WHERE fs.recipient_id IS NOT NULL
  AND fs.status IN ('sent', 'viewed', 'imported')

UNION ALL

SELECT 
  es.id as share_id,
  'event' as kind,
  es.recipient_id,
  es.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  r.handle as recipient_handle,
  r.display_name as recipient_display_name,
  r.avatar_url as recipient_avatar_url,
  es.event_id::text as payload_id,
  es.event_title as title,
  es.created_at,
  es.viewed_at,
  es.imported_at,
  es.suggested_schedule,
  es.event_date,
  NULL as payload_json
FROM event_shares es
LEFT JOIN profiles s ON es.sender_id = s.id
LEFT JOIN profiles r ON es.recipient_id = r.id
WHERE es.recipient_id IS NOT NULL
  AND es.status IN ('sent', 'viewed', 'imported');





