-- Phase 4: Drop legacy withdrawal columns from products_v2
-- These columns are no longer referenced by any runtime code, view, RPC, or trigger.
-- The FK constraint products_v2_withdrawal_unit_id_fkey will be dropped automatically.

ALTER TABLE public.products_v2
  DROP COLUMN IF EXISTS withdrawal_unit_id,
  DROP COLUMN IF EXISTS withdrawal_steps,
  DROP COLUMN IF EXISTS withdrawal_default_step;