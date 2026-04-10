
-- ═══════════════════════════════════════════════════════════════════════
-- CLEAN PACK V0: 3 contraintes DB chirurgicales
-- ═══════════════════════════════════════════════════════════════════════

-- A. purchase_line_items: UNIQUE (invoice_id, source_line_id)
--    Empêche les doublons lors de double validation / retry / 2 onglets
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_line_items_invoice_source
  ON public.purchase_line_items (invoice_id, source_line_id);

-- B. bl_app_lines: UNIQUE (bl_app_document_id, product_id) 
--    Requis par le upsert onConflict dans blAppService.ts
--    (vérifie que la contrainte existe, sinon la crée)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_app_lines_doc_product
  ON public.bl_app_lines (bl_app_document_id, product_id);

-- C. inventory_sessions: 1 session active max par zone
--    Empêche 2 sessions en_cours/en_pause sur la même zone (race condition)
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_sessions_one_active_per_zone
  ON public.inventory_sessions (establishment_id, storage_zone_id)
  WHERE status IN ('en_cours', 'en_pause');
