
-- Migration: Remove dish orders module — retry without IF EXISTS on publication

-- 1. Drop FK from app_invoices
ALTER TABLE public.app_invoices DROP CONSTRAINT IF EXISTS app_invoices_commande_plat_id_fkey;
ALTER TABLE public.app_invoices DROP COLUMN IF EXISTS commande_plat_id;

-- 2. Drop app_invoice_dish_lines
DROP TABLE IF EXISTS public.app_invoice_dish_lines CASCADE;

-- 3. Drop litige tables
DROP TABLE IF EXISTS public.litige_plat_lines CASCADE;
DROP TABLE IF EXISTS public.litige_plats CASCADE;

-- 4. Drop order_groups
DROP TABLE IF EXISTS public.order_groups CASCADE;

-- 5. Drop commande_plat_lines
DROP TABLE IF EXISTS public.commande_plat_lines CASCADE;

-- 6. Drop commande_plats
DROP TABLE IF EXISTS public.commande_plats CASCADE;

-- 7. Drop RPCs
DROP FUNCTION IF EXISTS public.fn_send_commande_plat(uuid);
DROP FUNCTION IF EXISTS public.fn_open_commande_plat(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_ship_commande_plat(uuid, jsonb);
DROP FUNCTION IF EXISTS public.fn_receive_commande_plat(uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.fn_resolve_litige_plat(uuid);

-- 8. Drop enum type
DROP TYPE IF EXISTS public.commande_plat_status;
