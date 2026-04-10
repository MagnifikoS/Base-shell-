-- ============================================================
-- NETTOYAGE : Suppression de la migration 1:1 automatique
-- Passage en mode "à la demande" uniquement
-- ============================================================

-- 1. Détacher tous les produits (remettre inventory_article_id = NULL)
UPDATE public.products_v2
SET inventory_article_id = NULL
WHERE inventory_article_id IS NOT NULL;

-- 2. Supprimer tous les articles fantômes créés par la migration 1:1
DELETE FROM public.inventory_articles;