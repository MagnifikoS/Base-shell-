-- ═══════════════════════════════════════════════════════════════════════════
-- Étape 1: Ajout delivery_unit_id et price_display_unit_id sur products_v2
-- ═══════════════════════════════════════════════════════════════════════════

-- Unité de livraison physique (carton, colis, pièce...)
ALTER TABLE public.products_v2
ADD COLUMN delivery_unit_id UUID REFERENCES public.measurement_units(id);

-- Unité d'affichage du prix unitaire (pce, boîte, kg...)
ALTER TABLE public.products_v2
ADD COLUMN price_display_unit_id UUID REFERENCES public.measurement_units(id);

-- Index pour performance
CREATE INDEX idx_products_v2_delivery_unit_id ON public.products_v2(delivery_unit_id);
CREATE INDEX idx_products_v2_price_display_unit_id ON public.products_v2(price_display_unit_id);