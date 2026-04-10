
-- Add unique constraint for upsert on commande_plat_lines
ALTER TABLE public.commande_plat_lines
  ADD CONSTRAINT commande_plat_lines_parent_listing_key
  UNIQUE (commande_plat_id, listing_id);
