-- ═══════════════════════════════════════════════════════════════════════════
-- STOCK EVENTS — Add inventory_article_id for article-level aggregation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Context:
--   inventory_articles groups multiple products_v2 rows under a single
--   "article" for stock aggregation. stock_events currently tracks only
--   product_id. This migration adds inventory_article_id so queries can
--   aggregate stock at the article level without joining through products_v2.
--
-- Backward compatibility:
--   - inventory_article_id is NULLABLE (products without articles keep working)
--   - product_id is NOT changed (traceability preserved)
--   - No computation logic changes
--
-- Dependencies:
--   - 20260217100000_inventory_articles_table.sql (creates inventory_articles + products_v2.inventory_article_id)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add inventory_article_id to stock_events (nullable for backward compat)
ALTER TABLE public.stock_events ADD COLUMN IF NOT EXISTS inventory_article_id UUID REFERENCES public.inventory_articles(id);

-- 2. Index for article-level queries
CREATE INDEX IF NOT EXISTS idx_stock_events_inv_article ON public.stock_events(inventory_article_id) WHERE inventory_article_id IS NOT NULL;

-- 3. Backfill from products_v2 (only update events that have NULL inventory_article_id)
-- NOTE: stock_events has a trigger preventing UPDATE. We need to temporarily disable it.
ALTER TABLE public.stock_events DISABLE TRIGGER trg_stock_events_no_update;

UPDATE public.stock_events se
SET inventory_article_id = p.inventory_article_id
FROM public.products_v2 p
WHERE se.product_id = p.id
  AND p.inventory_article_id IS NOT NULL
  AND se.inventory_article_id IS NULL;

ALTER TABLE public.stock_events ENABLE TRIGGER trg_stock_events_no_update;
