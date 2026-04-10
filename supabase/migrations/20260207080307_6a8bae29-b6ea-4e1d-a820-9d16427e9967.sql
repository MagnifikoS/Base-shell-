-- Add produits_v2 module to the modules table for RBAC
INSERT INTO public.modules (key, name, display_order)
VALUES ('produits_v2', 'Produits V2', 106)
ON CONFLICT (key) DO NOTHING;