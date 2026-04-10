-- Fix P0: Allow 'cancelled' in b2b_status check constraint
-- This unblocks fn_cancel_b2b_shipment when invoices exist
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_b2b_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_b2b_status_check 
  CHECK (b2b_status IS NULL OR b2b_status IN ('issued', 'received', 'cancelled'));