-- ═══════════════════════════════════════════════════════════════════════════
-- SSOT GUARD: canonical_family must always match measurement_units.family
-- Prevents corrupted events/lines from ever being inserted again.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Trigger for stock_events
CREATE OR REPLACE FUNCTION public.fn_validate_canonical_family_event()
RETURNS TRIGGER AS $$
DECLARE
  real_family TEXT;
BEGIN
  SELECT family INTO real_family
  FROM public.measurement_units
  WHERE id = NEW.canonical_unit_id;
  
  IF real_family IS NULL THEN
    RAISE EXCEPTION 'EVENT_UNIT_NOT_FOUND: canonical_unit_id "%" does not exist in measurement_units', NEW.canonical_unit_id;
  END IF;
  
  IF NEW.canonical_family != real_family THEN
    RAISE EXCEPTION 'EVENT_FAMILY_INVALID: canonical_family "%" does not match measurement_units.family "%" for unit "%"', 
      NEW.canonical_family, real_family, NEW.canonical_unit_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_stock_events_validate_family
  BEFORE INSERT ON public.stock_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_canonical_family_event();

-- 2. Trigger for stock_document_lines
CREATE OR REPLACE FUNCTION public.fn_validate_canonical_family_line()
RETURNS TRIGGER AS $$
DECLARE
  real_family TEXT;
BEGIN
  SELECT family INTO real_family
  FROM public.measurement_units
  WHERE id = NEW.canonical_unit_id;
  
  IF real_family IS NULL THEN
    RAISE EXCEPTION 'LINE_UNIT_NOT_FOUND: canonical_unit_id "%" does not exist in measurement_units', NEW.canonical_unit_id;
  END IF;
  
  IF NEW.canonical_family != real_family THEN
    RAISE EXCEPTION 'LINE_FAMILY_INVALID: canonical_family "%" does not match measurement_units.family "%" for unit "%"', 
      NEW.canonical_family, real_family, NEW.canonical_unit_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;