-- P1-2: Atomic increment for counted_products on inventory sessions
-- Prevents race conditions when multiple devices count simultaneously

CREATE OR REPLACE FUNCTION public.increment_counted_products(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE inventory_sessions
  SET counted_products = counted_products + 1,
      updated_at = now()
  WHERE id = p_session_id;
END;
$$;