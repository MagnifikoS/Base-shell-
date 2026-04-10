-- Drop the legacy overload of fn_receive_commande with wrong parameter order
DROP FUNCTION IF EXISTS public.fn_receive_commande(uuid, jsonb, uuid);