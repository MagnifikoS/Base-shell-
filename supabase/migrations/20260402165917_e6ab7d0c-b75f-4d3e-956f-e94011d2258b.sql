-- ═══ FIX RLS: Lock commandes & lines to brouillon only (client side) ═══

-- 1. commandes_update: brouillon only
DROP POLICY IF EXISTS "commandes_update" ON commandes;
CREATE POLICY "commandes_update" ON commandes FOR UPDATE
USING (
  client_establishment_id IN (SELECT get_user_establishment_ids())
  AND status = 'brouillon'
);

-- 2. commande_lines_insert: brouillon only
DROP POLICY IF EXISTS "commande_lines_insert" ON commande_lines;
CREATE POLICY "commande_lines_insert" ON commande_lines FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.client_establishment_id IN (SELECT get_user_establishment_ids())
      AND c.status = 'brouillon'
  )
);

-- 3. commande_lines_update: brouillon only
DROP POLICY IF EXISTS "commande_lines_update" ON commande_lines;
CREATE POLICY "commande_lines_update" ON commande_lines FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.client_establishment_id IN (SELECT get_user_establishment_ids())
      AND c.status = 'brouillon'
  )
);

-- 4. commande_lines_delete: brouillon only
DROP POLICY IF EXISTS "commande_lines_delete" ON commande_lines;
CREATE POLICY "commande_lines_delete" ON commande_lines FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM commandes c
    WHERE c.id = commande_lines.commande_id
      AND c.client_establishment_id IN (SELECT get_user_establishment_ids())
      AND c.status = 'brouillon'
  )
);