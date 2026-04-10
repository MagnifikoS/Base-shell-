
-- Add dismissed_at column to reception_lot_dlc for marking alerts as treated
-- NULL = active alert, non-NULL = dismissed (removed from DLC critique view)
ALTER TABLE public.reception_lot_dlc 
ADD COLUMN IF NOT EXISTS dismissed_at timestamptz DEFAULT NULL;

-- Add dismissed_reason for audit trail
ALTER TABLE public.reception_lot_dlc 
ADD COLUMN IF NOT EXISTS dismissed_reason text DEFAULT NULL;
