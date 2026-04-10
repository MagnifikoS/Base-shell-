
-- ═══════════════════════════════════════════════════════════════════
-- CURATIF: Remap 366 legacy stock_events with wrong unit UUIDs
-- ═══════════════════════════════════════════════════════════════════

-- 1. Disable blocking triggers temporarily
ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_update;
ALTER TABLE stock_events DISABLE TRIGGER trg_guard_stock_event_unit_ownership;

-- 2. Remap contaminated unit IDs to local equivalents
UPDATE stock_events se
SET canonical_unit_id = mu_local.id
FROM measurement_units mu_foreign, measurement_units mu_local
WHERE mu_foreign.id = se.canonical_unit_id
  AND mu_foreign.establishment_id != se.establishment_id
  AND mu_local.name = mu_foreign.name
  AND mu_local.family = mu_foreign.family
  AND mu_local.establishment_id = se.establishment_id
  AND se.event_type != 'VOID';

-- 3. Re-enable triggers
ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_update;
ALTER TABLE stock_events ENABLE TRIGGER trg_guard_stock_event_unit_ownership;
