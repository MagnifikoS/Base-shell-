-- Historical discrepancies from existing negative stocks (idempotent)
INSERT INTO public.inventory_discrepancies (
  establishment_id, organization_id, product_id, storage_zone_id,
  withdrawal_quantity, estimated_stock_before, gap_quantity,
  canonical_unit_id, withdrawn_by, withdrawal_reason,
  source_document_id, source_type, status, resolution_note, withdrawn_at
)
SELECT
  p.establishment_id, e.organization_id, p.id, p.storage_zone_id,
  0, stock.estimated, ABS(stock.estimated),
  stock.canonical_unit_id, NULL, NULL,
  NULL, 'migration_initiale', 'open',
  'Écart existant avant mise en place du module — stock négatif détecté automatiquement',
  NOW()
FROM public.products_v2 p
INNER JOIN public.establishments e ON e.id = p.establishment_id
INNER JOIN LATERAL (
  SELECT
    COALESCE(snap_qty.total, 0) + COALESCE(evt_delta.total, 0) AS estimated,
    COALESCE(evt_delta.unit_id, snap_qty.unit_id) AS canonical_unit_id
  FROM (SELECT 1) AS _dummy
  LEFT JOIN LATERAL (
    SELECT SUM(il.quantity) AS total,
           (ARRAY_AGG(il.unit_id) FILTER (WHERE il.unit_id IS NOT NULL))[1] AS unit_id
    FROM public.inventory_lines il
    INNER JOIN public.zone_stock_snapshots zss
      ON zss.snapshot_version_id = il.session_id
      AND zss.establishment_id = p.establishment_id
      AND zss.storage_zone_id = p.storage_zone_id
    WHERE il.product_id = p.id AND il.quantity IS NOT NULL
  ) snap_qty ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(se.delta_quantity_canonical) AS total,
           (ARRAY_AGG(se.canonical_unit_id) FILTER (WHERE se.canonical_unit_id IS NOT NULL))[1] AS unit_id
    FROM public.stock_events se
    WHERE se.establishment_id = p.establishment_id AND se.product_id = p.id
  ) evt_delta ON TRUE
) stock ON stock.estimated < 0
WHERE p.archived_at IS NULL
  AND p.storage_zone_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_discrepancies d
    WHERE d.establishment_id = p.establishment_id
      AND d.product_id = p.id
      AND d.source_type = 'migration_initiale'
  );