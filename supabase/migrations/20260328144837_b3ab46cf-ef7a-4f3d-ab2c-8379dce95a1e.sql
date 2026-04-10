
-- Fix the test commande_line to use client's local product ID and unit
UPDATE commande_lines 
SET product_id = 'f0739cfe-867f-468c-9da5-3b2488ce0ee7',
    canonical_unit_id = 'abcfd4d7-c5de-4d98-bdbe-8a1f30bd0c0d',
    product_name_snapshot = 'BURRATA 125G (test mutualisé)',
    unit_label_snapshot = 'Boîte'
WHERE id = 'd50ab950-51f7-4247-821f-ca9843e163d2';
