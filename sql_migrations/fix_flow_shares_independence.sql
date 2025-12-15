-- Fix flow_shares independence: make flow_id nullable and use ON DELETE SET NULL
-- This ensures that when a sender deletes their flow, the shared copy in the
-- recipient's inbox remains intact (using payload_json as the source of truth)

-- 1) Make flow_id nullable so we can safely set it to NULL on delete
ALTER TABLE public.flow_shares
  ALTER COLUMN flow_id DROP NOT NULL;

-- 2) Drop existing FK if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = 'public.flow_shares'::regclass
    AND    conname = 'flow_shares_flow_id_fkey'
    AND    contype = 'f'
  ) THEN
    ALTER TABLE public.flow_shares
      DROP CONSTRAINT flow_shares_flow_id_fkey;
  END IF;
END $$;

-- 3) Re-add FK with ON DELETE SET NULL so shares survive when original flow is deleted
ALTER TABLE public.flow_shares
  ADD CONSTRAINT flow_shares_flow_id_fkey
  FOREIGN KEY (flow_id) REFERENCES public.flows(id)
  ON DELETE SET NULL;





