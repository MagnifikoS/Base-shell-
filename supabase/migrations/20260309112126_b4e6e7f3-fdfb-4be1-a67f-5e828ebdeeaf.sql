-- Fix litige_plat_lines: rename columns to match RPC and add delta
ALTER TABLE public.litige_plat_lines 
  RENAME COLUMN shipped_quantity TO shipped_quantity_snapshot;

ALTER TABLE public.litige_plat_lines 
  RENAME COLUMN received_quantity TO received_quantity_snapshot;

ALTER TABLE public.litige_plat_lines 
  ADD COLUMN IF NOT EXISTS delta integer NOT NULL DEFAULT 0;