
-- Purge zone_stock_snapshots for NONNA SECRET
DELETE FROM public.zone_stock_snapshots WHERE snapshot_version_id IN (
  SELECT id FROM public.inventory_sessions WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);

-- Purge inventory lines
DELETE FROM public.inventory_lines WHERE session_id IN (
  SELECT id FROM public.inventory_sessions WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000'
);

-- Purge inventory sessions
DELETE FROM public.inventory_sessions WHERE establishment_id = '7775d89d-9977-4b1b-bf0c-1b2efe486000';
