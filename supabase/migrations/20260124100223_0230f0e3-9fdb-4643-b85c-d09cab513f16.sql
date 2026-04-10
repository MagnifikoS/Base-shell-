-- Add paie module to public.modules for RBAC compliance
INSERT INTO public.modules (key, name, display_order)
VALUES ('paie', 'Paie', 16)
ON CONFLICT (key) DO NOTHING;