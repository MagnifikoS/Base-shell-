-- ═══════════════════════════════════════════════════════════════════════
-- FIX: Allow inventory users to READ suppliers (for Reception flow)
-- No changes to INSERT/UPDATE/DELETE policies
-- No changes to RBAC core
-- ═══════════════════════════════════════════════════════════════════════

CREATE POLICY "Inventory users can view suppliers for reception"
ON public.invoice_suppliers
FOR SELECT
USING (has_module_access('inventaire'::text, 'read'::access_level, establishment_id));