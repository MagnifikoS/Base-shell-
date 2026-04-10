
-- Phase D: Drop legacy text columns from products_v2
-- These columns are fully replaced by UUID FK columns:
--   supplier_name      → supplier_id (FK → invoice_suppliers)
--   final_unit         → final_unit_id (FK → measurement_units)
--   supplier_billing_unit → supplier_billing_unit_id (FK → measurement_units)

ALTER TABLE public.products_v2
  DROP COLUMN IF EXISTS supplier_name,
  DROP COLUMN IF EXISTS final_unit,
  DROP COLUMN IF EXISTS supplier_billing_unit;
