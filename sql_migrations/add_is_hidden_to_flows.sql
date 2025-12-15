-- Migration: Add is_hidden column to flows table for repeating notes feature
-- Date: 2024
-- Description: Adds is_hidden boolean column to support hidden micro-flows
--              that back repeating individual notes. These flows should not
--              appear in Flow Studio or other user-facing flow lists.

ALTER TABLE flows 
ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;

-- Add index for filtering (optional but recommended for performance)
CREATE INDEX IF NOT EXISTS idx_flows_is_hidden ON flows(is_hidden) WHERE is_hidden = FALSE;

-- Update existing flows to ensure they're not hidden (safety measure)
UPDATE flows SET is_hidden = FALSE WHERE is_hidden IS NULL;





