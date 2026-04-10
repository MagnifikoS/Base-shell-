-- ═══════════════════════════════════════════════════════════════════════════
-- Étape 3 : Ajout source_order_id sur stock_documents pour lien DRAFT ↔ commande
-- Élimine la collision D8 (perte silencieuse de lignes inter-commandes)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ajouter la colonne source_order_id (nullable — la plupart des documents ne sont pas liés à une commande)
ALTER TABLE stock_documents
  ADD COLUMN source_order_id uuid REFERENCES product_orders(id);

-- 2. Ajouter un index pour la recherche rapide de DRAFT par commande
CREATE INDEX idx_stock_documents_source_order_draft
  ON stock_documents (establishment_id, source_order_id, type)
  WHERE status = 'DRAFT' AND source_order_id IS NOT NULL;

-- 3. Ajouter un index partiel unique : 1 seul DRAFT RECEIPT par commande
CREATE UNIQUE INDEX uq_stock_documents_one_draft_per_order
  ON stock_documents (establishment_id, source_order_id, type)
  WHERE status = 'DRAFT' AND source_order_id IS NOT NULL;