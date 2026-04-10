
-- Drop the OLD overload (p_commande_id, p_lines, p_user_id) - without bootstrap logic
-- Keep only the new one (p_commande_id, p_user_id, p_lines) with auto-bootstrap
DROP FUNCTION IF EXISTS public.fn_ship_commande(uuid, jsonb, uuid);
