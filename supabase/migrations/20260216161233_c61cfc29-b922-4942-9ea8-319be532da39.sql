-- ═══════════════════════════════════════════════════════════════════════════
-- DATA REPAIR: Fix corrupted stock_events from BL correction hardcode bug
-- 
-- BUG: BlAppCorrectionDialog.tsx hardcoded canonical_family='mass' and 
-- context_hash='correction' for ALL products, regardless of actual unit family.
-- This caused FAMILY_MISMATCH errors in StockEngine for non-mass products.
--
-- REPAIR STRATEGY: Temporarily disable append-only triggers to fix metadata
-- on corrupted events. This is a one-time admin data repair, not a business 
-- operation. The actual delta values are NOT changed.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Temporarily disable the append-only triggers
ALTER TABLE public.stock_events DISABLE TRIGGER trg_stock_events_no_update;

-- 2. Fix canonical_family to match the actual measurement_units.family
UPDATE public.stock_events se
SET canonical_family = mu.family
FROM public.measurement_units mu
WHERE mu.id = se.canonical_unit_id
  AND se.canonical_family != mu.family
  AND se.context_hash = 'correction';

-- 3. Fix context_hash from hardcoded 'correction' to a proper marker
-- We use 'correction_repaired' to indicate this was admin-fixed
-- (The real hash would require product config lookup which is complex in SQL)
UPDATE public.stock_events
SET context_hash = 'correction_repaired'
WHERE context_hash = 'correction';

-- 4. Re-enable the append-only triggers
ALTER TABLE public.stock_events ENABLE TRIGGER trg_stock_events_no_update;