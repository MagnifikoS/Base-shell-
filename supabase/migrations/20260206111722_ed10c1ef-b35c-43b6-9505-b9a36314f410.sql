-- Add French name column to products table
-- Stores the French translation when the original product name is in another language
ALTER TABLE public.products 
ADD COLUMN nom_produit_fr TEXT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.products.nom_produit_fr IS 'French translation of nom_produit when original is in foreign language. NULL if original is already French.';