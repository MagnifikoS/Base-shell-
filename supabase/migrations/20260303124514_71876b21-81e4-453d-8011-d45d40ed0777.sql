
-- 1. Prevent self-partnership at DB level
ALTER TABLE public.b2b_partnerships
ADD CONSTRAINT b2b_partnerships_no_self
CHECK (supplier_establishment_id <> client_establishment_id);

-- 2. Restrict UPDATE policy to archival-only columns
DROP POLICY IF EXISTS b2b_partnerships_update ON public.b2b_partnerships;

CREATE POLICY "b2b_partnerships_update_archive_only"
ON public.b2b_partnerships
FOR UPDATE
TO authenticated
USING (
  (supplier_establishment_id IN (SELECT get_user_establishment_ids()))
  OR (client_establishment_id IN (SELECT get_user_establishment_ids()))
)
WITH CHECK (
  (supplier_establishment_id IN (SELECT get_user_establishment_ids()))
  OR (client_establishment_id IN (SELECT get_user_establishment_ids()))
);
