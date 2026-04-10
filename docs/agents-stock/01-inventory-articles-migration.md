# Agent 01: InventoryArticlesMigration

## Mission
Create the `inventory_articles` table and add `inventory_article_id` FK to `products_v2`. Run a 1:1 auto-migration so every existing product gets its own inventory article. Zero downtime, zero data loss.

## Context: Why This Exists
Currently `products_v2` = supplier product (1 supplier, 1 code, 1 price). But in reality, multiple suppliers sell the SAME ingredient (e.g., Grana from Cincotti AND from Sapori). Today they create separate stock entries. We need a shared "inventory article" that multiple supplier products can feed into.

## Current Schema (DO NOT modify these tables' structure)
```sql
-- products_v2: supplier product (existing, unchanged)
-- Key columns: id, establishment_id, nom_produit, storage_zone_id, 
--   stock_handling_unit_id, final_unit_id, supplier_id, supplier_name

-- stock_events: uses product_id → products_v2.id (will later point to inventory_article_id)
-- stock_documents: grouping of events
-- inventory_sessions: inventory counting sessions
```

## Phase A: Database Migration

### New Table: `inventory_articles`
```sql
CREATE TABLE public.inventory_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL, -- lowercase, trimmed, for matching
  storage_zone_id UUID REFERENCES public.storage_zones(id),
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  canonical_family TEXT NOT NULL, -- "mass", "volume", "unit"
  min_stock_quantity_canonical NUMERIC,
  min_stock_unit_id UUID REFERENCES public.measurement_units(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE public.inventory_articles ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_inv_articles_establishment ON public.inventory_articles(establishment_id) WHERE archived_at IS NULL;
CREATE INDEX idx_inv_articles_zone ON public.inventory_articles(storage_zone_id) WHERE archived_at IS NULL;
CREATE INDEX idx_inv_articles_name_norm ON public.inventory_articles(establishment_id, name_normalized);
```

### Alter `products_v2`
```sql
ALTER TABLE public.products_v2 ADD COLUMN IF NOT EXISTS inventory_article_id UUID REFERENCES public.inventory_articles(id);
CREATE INDEX idx_products_v2_inv_article ON public.products_v2(inventory_article_id) WHERE archived_at IS NULL;
```

### Auto-migration: 1:1 products → articles
```sql
-- For each non-archived products_v2 that has stock_handling_unit_id:
-- 1. Create an inventory_article with same name/zone/unit
-- 2. Link products_v2.inventory_article_id = new article id
INSERT INTO public.inventory_articles (establishment_id, name, name_normalized, storage_zone_id, canonical_unit_id, canonical_family, min_stock_quantity_canonical, min_stock_unit_id)
SELECT 
  p.establishment_id,
  p.nom_produit,
  lower(trim(p.nom_produit)),
  p.storage_zone_id,
  p.stock_handling_unit_id,
  COALESCE(u.family, 'unit'),
  p.min_stock_quantity_canonical,
  p.min_stock_unit_id
FROM public.products_v2 p
LEFT JOIN public.measurement_units u ON u.id = p.stock_handling_unit_id
WHERE p.archived_at IS NULL
  AND p.stock_handling_unit_id IS NOT NULL;

-- Then link back:
UPDATE public.products_v2 p
SET inventory_article_id = ia.id
FROM public.inventory_articles ia
WHERE ia.establishment_id = p.establishment_id
  AND ia.name = p.nom_produit
  AND ia.canonical_unit_id = p.stock_handling_unit_id
  AND p.archived_at IS NULL
  AND p.inventory_article_id IS NULL;
```

## Files to create/modify
- NEW: `supabase/migrations/YYYYMMDD_inventory_articles_table.sql`
- NEW: `supabase/migrations/YYYYMMDD_inventory_articles_migration.sql`
- NEW: `src/modules/inventaire/types/inventoryArticle.ts`

## What NOT to change
- `stock_events` table structure (Phase B will update the FK)
- `resolveProductUnitContext` 
- `stock_documents`
- Ledger logic
- Canonical logic

## Tests
- [ ] Migration creates 1 article per non-archived product with stock unit
- [ ] `inventory_article_id` is set on all migrated products
- [ ] Products without `stock_handling_unit_id` are skipped (no article created)
- [ ] RLS policies work (user can only see own establishment's articles)
- [ ] Indexes created

## Definition of Done
- [ ] Table created with RLS
- [ ] 1:1 migration script runs cleanly
- [ ] Types defined in TypeScript
- [ ] Zero downtime — additive changes only
