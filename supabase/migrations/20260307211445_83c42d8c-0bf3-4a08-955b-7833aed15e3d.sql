
-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER: Normalize code_produit on ALL writes to products_v2
-- Converts '', 'null', 'NULL', whitespace-only → SQL NULL
-- Applies TRIM() on valid values
-- Protects ALL write paths: B2B import, VisionAI, manual create/update
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.normalize_code_produit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code_produit IS NOT NULL THEN
    -- Trim whitespace
    NEW.code_produit := TRIM(NEW.code_produit);
    -- Empty string → NULL
    NEW.code_produit := NULLIF(NEW.code_produit, '');
    -- String 'null'/'NULL' → NULL
    IF NEW.code_produit IS NOT NULL AND lower(NEW.code_produit) = 'null' THEN
      NEW.code_produit := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach to products_v2 BEFORE INSERT OR UPDATE
CREATE TRIGGER trg_normalize_code_produit
  BEFORE INSERT OR UPDATE ON public.products_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_code_produit();

-- ═══════════════════════════════════════════════════════════════════════════
-- Also clean up any existing bad data in products_v2
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.products_v2
SET code_produit = NULL
WHERE code_produit IS NOT NULL
  AND (
    TRIM(code_produit) = ''
    OR lower(TRIM(code_produit)) = 'null'
  );
