
-- ═══════════════════════════════════════════════════════════════════════════
-- PURGE: Module Commande Produits — Drop all DB objects
-- Tables, RPCs, triggers, related functions
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Drop triggers
DROP TRIGGER IF EXISTS trg_order_status_transition_guard ON public.product_orders;

-- 2. Drop RPCs / Functions
DROP FUNCTION IF EXISTS public.fn_create_order(UUID, UUID, UUID, TEXT, UUID, JSONB);
DROP FUNCTION IF EXISTS public.fn_ship_order(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS public.fn_receive_order(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS public.fn_delete_order_line(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_send_commande_notification(TEXT, UUID);
DROP FUNCTION IF EXISTS public.validate_order_status_transition();

-- 3. Drop tables (lines first due to FK)
DROP TABLE IF EXISTS public.product_order_lines CASCADE;
DROP TABLE IF EXISTS public.product_orders CASCADE;
