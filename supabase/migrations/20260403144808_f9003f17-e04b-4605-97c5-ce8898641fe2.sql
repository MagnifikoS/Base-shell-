
-- Drop the OLD overload (p_commande_id, p_user_id, p_lines) that conflicts
DROP FUNCTION IF EXISTS public.fn_ship_commande(uuid, uuid, jsonb);
