-- Drop 3 dead RPCs identified in AUDIT_COMMANDES_V0.5
DROP FUNCTION IF EXISTS public.fn_send_commande_notification(text, uuid);
DROP FUNCTION IF EXISTS public.fn_send_commande_notification(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_update_commande_if_unlocked(uuid, text);
DROP FUNCTION IF EXISTS public.resolve_supplier_products_for_shipment(uuid, uuid[]);