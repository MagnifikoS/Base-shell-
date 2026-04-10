-- Add module 'alertes' to public.modules (idempotent)
INSERT INTO public.modules (key, name, display_order)
VALUES ('alertes', 'Alertes', 15)
ON CONFLICT (key) DO NOTHING;