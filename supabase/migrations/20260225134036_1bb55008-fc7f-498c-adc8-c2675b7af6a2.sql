
-- Allow destination establishment users of a product_order to read the BL Réception document
-- This mirrors the existing cross-org pattern on bl_withdrawal_documents

CREATE POLICY "Order destination can view bl_app_documents"
ON public.bl_app_documents
FOR SELECT
USING (
  id IN (
    SELECT po.bl_reception_document_id
    FROM product_orders po
    WHERE po.bl_reception_document_id IS NOT NULL
      AND user_belongs_to_establishment(auth.uid(), po.destination_establishment_id)
  )
);

-- Allow destination establishment users to read BL Réception lines
CREATE POLICY "Order destination can view bl_app_lines"
ON public.bl_app_lines
FOR SELECT
USING (
  bl_app_document_id IN (
    SELECT po.bl_reception_document_id
    FROM product_orders po
    WHERE po.bl_reception_document_id IS NOT NULL
      AND user_belongs_to_establishment(auth.uid(), po.destination_establishment_id)
  )
);
