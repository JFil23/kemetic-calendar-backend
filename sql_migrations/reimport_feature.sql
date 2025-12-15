-- ============================================================================
-- RE-IMPORT FEATURE: Database Migration
-- ============================================================================
-- This migration adds share_id tracking to flows table and automatic cleanup
-- Run this in Supabase SQL Editor

-- Add share_id column to flows table to track original share
ALTER TABLE flows 
ADD COLUMN share_id TEXT REFERENCES flow_shares(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_flows_share_id ON flows(share_id);

-- Add trigger to automatically clear import status when flow is deleted
CREATE OR REPLACE FUNCTION clear_flow_import_status()
RETURNS TRIGGER AS $$
BEGIN
  -- When a flow is deleted, clear the imported_at timestamp
  -- This allows the flow to be re-imported from inbox
  UPDATE flow_shares
  SET imported_at = NULL
  WHERE id = OLD.share_id;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clear_import_on_flow_delete
AFTER DELETE ON flows
FOR EACH ROW
WHEN (OLD.share_id IS NOT NULL)
EXECUTE FUNCTION clear_flow_import_status();

-- Add comment for documentation
COMMENT ON COLUMN flows.share_id IS 'References the original flow_shares.id if this flow was imported from inbox';
COMMENT ON INDEX idx_flows_share_id IS 'Index for fast lookups of flows by their original share_id';


