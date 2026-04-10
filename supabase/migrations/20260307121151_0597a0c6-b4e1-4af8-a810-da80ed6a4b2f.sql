
-- Drop the additional trigger that depends on inventory_article_id
DROP TRIGGER IF EXISTS trg_clear_threshold_on_unlink ON public.products_v2;
DROP FUNCTION IF EXISTS fn_clear_threshold_on_unlink();

-- Now drop the column with CASCADE to catch any remaining dependencies
ALTER TABLE public.products_v2 DROP COLUMN IF EXISTS inventory_article_id CASCADE;

-- Drop indexes on inventory_articles
DROP INDEX IF EXISTS idx_inv_articles_establishment;
DROP INDEX IF EXISTS idx_inv_articles_zone;
DROP INDEX IF EXISTS idx_inv_articles_name_norm;

-- Drop the table itself
DROP TABLE IF EXISTS public.inventory_articles CASCADE;
