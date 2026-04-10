-- Add 'presence' module for distinct RBAC attribution
-- Idempotent: uses ON CONFLICT DO NOTHING (primary key on 'key')
INSERT INTO public.modules (key, name, display_order)
VALUES ('presence', 'Présence', 13)
ON CONFLICT (key) DO NOTHING;