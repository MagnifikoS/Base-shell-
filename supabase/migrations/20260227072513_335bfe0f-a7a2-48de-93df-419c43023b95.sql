
-- Fix test products: move to zones WITH active snapshots
-- Nonna: Épicerie (3b238780) → STOCKAGE ENTRER (dcfd334b) 
-- Nonna: Chambre froide (a3f25e23) → CHAMBRE FROIDE 1 (38b97f33)
UPDATE products_v2 SET storage_zone_id = 'dcfd334b-0b2e-4839-a8ae-b34cbd4efd7e'
WHERE id IN ('a0000001-0e50-b2b0-0000-000000000001','a0000001-0e50-b2b0-0000-000000000003','a0000001-0e50-b2b0-0000-000000000005')
AND nom_produit LIKE '[TEST]%';

UPDATE products_v2 SET storage_zone_id = '38b97f33-aff2-4a87-a0b4-034a0b182d94'
WHERE id IN ('a0000001-0e50-b2b0-0000-000000000002','a0000001-0e50-b2b0-0000-000000000004','a0000001-0e50-b2b0-0000-000000000006','a0000001-0e50-b2b0-0000-000000000007','a0000001-0e50-b2b0-0000-000000000008')
AND nom_produit LIKE '[TEST]%';
