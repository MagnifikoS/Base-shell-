# Agent 02: InventoryArticlesLedgerBridge

## Mission
Bridge the stock ledger to use `inventory_article_id` for stock calculations while keeping `product_id` for traceability. Zero change to computation logic — only the FK reference changes.

## Context
Currently `stock_events.product_id` → `products_v2.id`. After migration, the stock engine should aggregate by `inventory_article_id` so that multiple supplier products contribute to the same stock total.

## Current Architecture (DO NOT change logic)
```
stock_events → product_id → products_v2
                           → storage_zone_id
                           → stock_handling_unit_id (canonical)
```

## Target Architecture
```
stock_events → product_id (kept for traceability)
             → inventory_article_id (NEW — used for aggregation)
inventory_articles → canonical_unit_id, storage_zone_id
products_v2 → inventory_article_id (FK link)
```

## Changes

### Database
```sql
-- Add inventory_article_id to stock_events (nullable for backward compat)
ALTER TABLE public.stock_events ADD COLUMN IF NOT EXISTS inventory_article_id UUID REFERENCES public.inventory_articles(id);

-- Backfill from products_v2
UPDATE public.stock_events se
SET inventory_article_id = p.inventory_article_id
FROM public.products_v2 p
WHERE se.product_id = p.id
  AND p.inventory_article_id IS NOT NULL
  AND se.inventory_article_id IS NULL;

CREATE INDEX idx_stock_events_inv_article ON public.stock_events(inventory_article_id);
```

### Stock Engine (`src/modules/stockLedger/engine/`)
- `estimateStock()` — group by `inventory_article_id` instead of `product_id` when article exists
- `postDocument()` — set `inventory_article_id` from the product's linked article
- Keep `product_id` on every event for audit trail

### Edge Function: `supabase/functions/stock-ledger/index.ts`
- When posting events, resolve `inventory_article_id` from `products_v2.inventory_article_id`
- If product has no article → use product_id as before (backward compatible)

## Files to modify
- `supabase/migrations/YYYYMMDD_stock_events_article_id.sql`
- `src/modules/stockLedger/engine/stockEngine.ts` — aggregation query
- `supabase/functions/stock-ledger/index.ts` — event posting
- `src/modules/stockLedger/types.ts` — add `inventory_article_id` to types

## What NOT to change
- `delta_quantity_canonical` computation
- `canonical_unit_id` / `canonical_family` logic
- `context_hash` computation
- `snapshot_version_id` logic
- Void/correction logic

## Tests
- [ ] New events get `inventory_article_id` set automatically
- [ ] Stock aggregation groups by article (2 products → 1 article → 1 stock total)
- [ ] Products without article → old behavior unchanged
- [ ] Void events correctly copy `inventory_article_id` from original
- [ ] Estimated stock returns article-level totals

## Definition of Done
- [ ] `inventory_article_id` on `stock_events` with backfill
- [ ] Stock engine aggregates by article when available
- [ ] Zero change to existing stock values
- [ ] All existing tests pass
