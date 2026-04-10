-- ═══════════════════════════════════════════════════════════════
-- NETTOYAGE CIBLÉ — TEST1 / TEST2 / TEST3 uniquement (retry)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. BL App ──
DELETE FROM bl_app_lines WHERE bl_app_document_id = 'af290711-5f86-41a9-bedf-f93de956ac95';
DELETE FROM bl_app_documents WHERE id = 'af290711-5f86-41a9-bedf-f93de956ac95';

-- ── 2. Stock ──
ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE stock_events DISABLE TRIGGER trg_stock_events_no_update;
ALTER TABLE stock_events DISABLE TRIGGER trg_guard_stock_event_unit_ownership;

DELETE FROM stock_events WHERE document_id = 'ba022853-fb67-4979-a55f-5ff7e7965fff';
DELETE FROM stock_document_lines WHERE document_id = 'ba022853-fb67-4979-a55f-5ff7e7965fff';
DELETE FROM stock_documents WHERE id = 'ba022853-fb67-4979-a55f-5ff7e7965fff';

ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_delete;
ALTER TABLE stock_events ENABLE TRIGGER trg_stock_events_no_update;
ALTER TABLE stock_events ENABLE TRIGGER trg_guard_stock_event_unit_ownership;

-- ── 3. Commandes ──
ALTER TABLE commande_lines DISABLE TRIGGER guard_last_commande_line;

DELETE FROM commande_lines WHERE commande_id IN (
  '76f1d703-e619-44fa-a127-25bafea6b3fb',
  'a8cf8580-6e80-4b91-a8ad-5c07f1d89a8a',
  '51fbcf78-ff97-492d-9a0b-ee9b0aecb884',
  'd693a880-312d-4705-8400-46b6b5ffe8fe'
);

DELETE FROM commandes WHERE id IN (
  '76f1d703-e619-44fa-a127-25bafea6b3fb',
  'a8cf8580-6e80-4b91-a8ad-5c07f1d89a8a',
  '51fbcf78-ff97-492d-9a0b-ee9b0aecb884',
  'd693a880-312d-4705-8400-46b6b5ffe8fe'
);

ALTER TABLE commande_lines ENABLE TRIGGER guard_last_commande_line;

-- ── 4. Archiver les 6 produits (soft-delete) ──
UPDATE products_v2 SET archived_at = now() WHERE id IN (
  '008f7a9a-b4c8-4b09-9b46-c6e2dd1052df',
  'ce1f3a75-b7b3-4c72-9de4-f5ba686a004c',
  '70aa2663-7536-4cd1-a59d-6e731b2de3ce',
  'fcb37371-0a48-448d-ac1d-9a2ede2d85e0',
  '900646ff-6318-4282-aac3-df7651640125',
  'ae1de9ac-219a-4973-aced-46555eb485c6'
);