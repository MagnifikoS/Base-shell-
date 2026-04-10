
-- Trigger function: enforce structural integrity on products_v2
CREATE OR REPLACE FUNCTION fn_enforce_product_structural_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only enforce on active (non-archived) products
  IF NEW.archived_at IS NULL THEN
    IF NEW.final_unit_id IS NULL THEN
      RAISE EXCEPTION 'PRODUCT_INVALID:final_unit_id is required for active products';
    END IF;
    IF NEW.stock_handling_unit_id IS NULL THEN
      RAISE EXCEPTION 'PRODUCT_INVALID:stock_handling_unit_id is required for active products';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger: fires on INSERT and UPDATE
CREATE TRIGGER trg_enforce_product_integrity
  BEFORE INSERT OR UPDATE ON products_v2
  FOR EACH ROW
  EXECUTE FUNCTION fn_enforce_product_structural_integrity();
