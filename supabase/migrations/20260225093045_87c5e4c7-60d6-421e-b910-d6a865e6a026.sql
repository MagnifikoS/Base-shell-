
-- Insert module row (correct column names)
INSERT INTO public.modules (key, name, description, is_active, display_order)
VALUES ('clients', 'Clients', 'Gestion des clients et catalogues personnalisés (côté fournisseur)', true, 200)
ON CONFLICT (key) DO NOTHING;
