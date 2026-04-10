-- P0 cleanup: drop ghost function fn_post_b2b_reception
-- This function references the defunct product_orders table and is never called.
-- The real reception flow uses fn_receive_commande (called via commandes-api).
DROP FUNCTION IF EXISTS public.fn_post_b2b_reception(uuid, uuid, jsonb);