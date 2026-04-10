
-- Drop old overloads with wrong parameter order
DROP FUNCTION IF EXISTS public.fn_ship_commande(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.fn_receive_commande(uuid, uuid, jsonb);
