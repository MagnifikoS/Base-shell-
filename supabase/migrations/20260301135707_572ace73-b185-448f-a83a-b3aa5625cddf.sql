-- Drop B2B orphan tables: supplier_client_catalog_items, supplier_client_invitations, supplier_clients
-- All 3 tables are empty (0 rows) and have no frontend references.

-- 1. Drop RLS policies
DROP POLICY IF EXISTS client_read_catalog ON public.supplier_client_catalog_items;
DROP POLICY IF EXISTS supplier_manage_catalog ON public.supplier_client_catalog_items;
DROP POLICY IF EXISTS supplier_insert_invitations ON public.supplier_client_invitations;
DROP POLICY IF EXISTS supplier_read_own_invitations ON public.supplier_client_invitations;
DROP POLICY IF EXISTS supplier_update_invitations ON public.supplier_client_invitations;
DROP POLICY IF EXISTS read_supplier_clients ON public.supplier_clients;
DROP POLICY IF EXISTS supplier_update_clients ON public.supplier_clients;

-- 2. Drop tables (catalog_items first due to FK dependencies)
DROP TABLE IF EXISTS public.supplier_client_catalog_items;
DROP TABLE IF EXISTS public.supplier_client_invitations;
DROP TABLE IF EXISTS public.supplier_clients;