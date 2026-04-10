
-- 1. Make destination_establishment_id nullable in bl_withdrawal_documents
ALTER TABLE public.bl_withdrawal_documents 
  ALTER COLUMN destination_establishment_id DROP NOT NULL;

-- 2. Add destination_name column (optional label snapshot)
ALTER TABLE public.bl_withdrawal_documents 
  ADD COLUMN IF NOT EXISTS destination_name text;

-- 3. Create BL withdrawal number sequence function
CREATE OR REPLACE FUNCTION public.fn_next_bl_withdrawal_number(p_establishment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
  v_number text;
BEGIN
  SELECT COUNT(*) + 1
  INTO v_count
  FROM public.bl_withdrawal_documents
  WHERE establishment_id = p_establishment_id;

  v_number := 'BLR-' || TO_CHAR(NOW() AT TIME ZONE 'Europe/Paris', 'YYYYMM') || '-' || LPAD(v_count::text, 4, '0');
  RETURN v_number;
END;
$$;
