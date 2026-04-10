-- ═══════════════════════════════════════════════════════════════════════════
-- SIDEBAR V2.1 — Ajout des modules placeholders
-- ═══════════════════════════════════════════════════════════════════════════
-- Ces modules sont en "Coming Soon" mais doivent exister en DB pour le RBAC.
-- Ils seront visibles dans l'admin et configurables par rôle.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ajout des nouveaux modules (ignore si déjà existants)
INSERT INTO public.modules (key, name, display_order)
VALUES
  ('commandes', 'Commandes', 108),
  ('inventaire', 'Inventaire', 109),
  ('pertes', 'Pertes & Casse', 110),
  ('recettes', 'Recettes', 111),
  ('food_cost', 'Food Cost', 112),
  ('plat_du_jour', 'Plat du Jour', 113),
  ('contexte', 'Contexte & Événements', 114),
  ('assistant', 'Assistant IA', 115),
  ('materiel', 'Matériel', 210)
ON CONFLICT (key) DO NOTHING;