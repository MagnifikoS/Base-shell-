-- Add input_entries column to commande_lines
-- Purpose: will store the presentation snapshot of the user's quantity input intent
-- (e.g. [{unit_id: "...", quantity: 1, label: "carton"}, ...])
-- This column is NOT read or written by any code yet (Step 1 = schema only).
ALTER TABLE public.commande_lines
  ADD COLUMN input_entries jsonb DEFAULT NULL;