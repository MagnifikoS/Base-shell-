
-- PR-0: Reset complet des données opérationnelles
-- Désactive temporairement les triggers (y compris stock_events append-only)
SET session_replication_role = replica;

-- Vague 1 — Tables feuilles (pas d'enfants dans le périmètre)
DELETE FROM price_alerts;
DELETE FROM to_order_lines;
DELETE FROM supplier_product_aliases;
DELETE FROM stock_monthly_snapshot_lines;
DELETE FROM mep_order_lines;
DELETE FROM purchase_line_items;
DELETE FROM invoice_line_items;
DELETE FROM product_returns;
DELETE FROM reception_lot_dlc;
DELETE FROM litige_lines;
DELETE FROM recipe_lines;
DELETE FROM app_invoice_lines;
DELETE FROM inventory_mutualisation_members;
DELETE FROM bl_app_lines;
DELETE FROM bl_app_files;
DELETE FROM bl_withdrawal_lines;

-- Vague 2 — Parents directs de vague 1
DELETE FROM litiges;
DELETE FROM app_invoices;
DELETE FROM inventory_mutualisation_groups;
DELETE FROM bl_app_documents;
DELETE FROM bl_withdrawal_documents;

-- Vague 3 — Ledger stock (trigger append-only désactivé)
DELETE FROM stock_events;
DELETE FROM stock_document_lines;
DELETE FROM stock_documents;
DELETE FROM zone_stock_snapshots;
DELETE FROM stock_monthly_snapshots;

-- Vague 4 — Commandes (après stock_document_lines qui ref commande_lines)
DELETE FROM commande_lines;
DELETE FROM commandes;

-- Vague 5 — Inventaire
DELETE FROM inventory_discrepancies;
DELETE FROM inventory_lines;
DELETE FROM inventory_sessions;
DELETE FROM inventory_zone_products;

-- Vague 6 — B2B
DELETE FROM b2b_imported_products;

-- Vague 7 — Cœur produit (en dernier)
DELETE FROM product_input_config;
DELETE FROM products_v2;

-- Réactiver les triggers
SET session_replication_role = DEFAULT;
