
-- Initialize stock for GANT NITRILE NORE L in its new zone (Produit Hygienne Petite salle)
-- This product was moved before the ledger-safe transfer fix, so it has no snapshot line
SELECT public.fn_initialize_product_stock(
  'd3a59ad2-42c9-48c4-8265-7c822509a361'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid
);
