-- Temporarily disable terminated session guard trigger for migration
ALTER TABLE inventory_lines DISABLE TRIGGER trg_guard_terminated_session_lines;

-- Copy inventory_lines
INSERT INTO inventory_lines (id, session_id, product_id, quantity, unit_id, counted_at, counted_by, created_at, created_via, display_order, updated_at)
SELECT ml.new_id, ms.new_id, mp.new_id, l.quantity, mu.new_id, l.counted_at, l.counted_by, l.created_at, l.created_via, l.display_order, l.updated_at
FROM inventory_lines l
JOIN _migration_id_map ml ON ml.old_id = l.id AND ml.tbl = 'inventory_lines'
JOIN _migration_id_map ms ON ms.old_id = l.session_id AND ms.tbl = 'inventory_sessions'
LEFT JOIN _migration_id_map mp ON mp.old_id = l.product_id AND mp.tbl = 'products_v2'
LEFT JOIN _migration_id_map mu ON mu.old_id = l.unit_id AND mu.tbl = 'measurement_units';

-- Re-enable trigger
ALTER TABLE inventory_lines ENABLE TRIGGER trg_guard_terminated_session_lines;