
-- Add partner_establishment_id to invoice_suppliers for reliable cross-org matching
ALTER TABLE public.invoice_suppliers 
ADD COLUMN IF NOT EXISTS partner_establishment_id UUID REFERENCES public.establishments(id);

-- Backfill: match existing invoice_suppliers to their partner establishment
-- based on supplier_clients relationships and name matching
UPDATE invoice_suppliers isup
SET partner_establishment_id = sc.supplier_establishment_id
FROM supplier_clients sc
JOIN establishments e ON e.id = sc.supplier_establishment_id
WHERE isup.establishment_id = sc.client_establishment_id
  AND sc.status = 'active'
  AND isup.partner_establishment_id IS NULL
  AND isup.supplier_type = 'externe'
  AND (
    isup.name_normalized = lower(trim(e.name))
    OR isup.name_normalized = lower(trim(e.trade_name))
  );

-- Also try matching via establishment_profiles (trade_name / legal_name)
UPDATE invoice_suppliers isup
SET partner_establishment_id = sc.supplier_establishment_id
FROM supplier_clients sc
JOIN establishments e ON e.id = sc.supplier_establishment_id
LEFT JOIN establishment_profiles ep ON ep.establishment_id = e.id
WHERE isup.establishment_id = sc.client_establishment_id
  AND sc.status = 'active'
  AND isup.partner_establishment_id IS NULL
  AND isup.supplier_type = 'externe'
  AND (
    isup.name_normalized = lower(trim(ep.legal_name))
    OR isup.name_normalized = lower(trim(ep.contact_name))
  );

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_invoice_suppliers_partner_est_id 
ON invoice_suppliers(partner_establishment_id) WHERE partner_establishment_id IS NOT NULL;
