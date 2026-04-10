-- Allow suppliers to read b2b_imported_products rows where THEIR establishment is the source
CREATE POLICY "b2b_imported_products_select_supplier"
ON public.b2b_imported_products
FOR SELECT
TO authenticated
USING (source_establishment_id IN (SELECT get_user_establishment_ids()));