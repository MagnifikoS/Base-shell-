
-- ═══════════════════════════════════════════════════════════════
-- MODULE: Price Alerts (V0) — Étape 1 : Tables isolées + RLS
-- Supprimable indépendamment via DROP TABLE
-- ═══════════════════════════════════════════════════════════════

-- 1) Table: price_alert_settings (seuils par établissement client)
CREATE TABLE public.price_alert_settings (
  establishment_id uuid PRIMARY KEY REFERENCES public.establishments(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  global_threshold_pct numeric NOT NULL DEFAULT 5,
  category_thresholds jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.price_alert_settings IS 'Module Alertes Prix V0 — seuils de variation par établissement client';
COMMENT ON COLUMN public.price_alert_settings.category_thresholds IS 'JSON: {"catégorie": seuil_pct} — surcharges par catégorie';

ALTER TABLE public.price_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_alert_settings_select"
  ON public.price_alert_settings FOR SELECT TO authenticated
  USING (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "price_alert_settings_insert"
  ON public.price_alert_settings FOR INSERT TO authenticated
  WITH CHECK (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "price_alert_settings_update"
  ON public.price_alert_settings FOR UPDATE TO authenticated
  USING (establishment_id IN (SELECT get_user_establishment_ids()))
  WITH CHECK (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "price_alert_settings_delete"
  ON public.price_alert_settings FOR DELETE TO authenticated
  USING (establishment_id IN (SELECT get_user_establishment_ids()));

-- 2) Table: price_alerts (alertes de variation de prix)
CREATE TABLE public.price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  source_product_id uuid NOT NULL,
  supplier_name text NOT NULL DEFAULT '',
  product_name text NOT NULL DEFAULT '',
  category text,
  old_price numeric NOT NULL DEFAULT 0,
  new_price numeric NOT NULL DEFAULT 0,
  variation_pct numeric NOT NULL DEFAULT 0,
  day_date date NOT NULL DEFAULT CURRENT_DATE,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, establishment_id, day_date)
);

COMMENT ON TABLE public.price_alerts IS 'Module Alertes Prix V0 — alertes de variation prix B2B';

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_alerts_select"
  ON public.price_alert_settings FOR SELECT TO authenticated
  USING (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "price_alerts_update"
  ON public.price_alerts FOR UPDATE TO authenticated
  USING (establishment_id IN (SELECT get_user_establishment_ids()));

-- Index pour requêtes fréquentes
CREATE INDEX idx_price_alerts_establishment_date
  ON public.price_alerts(establishment_id, day_date DESC);

CREATE INDEX idx_price_alerts_unseen
  ON public.price_alerts(establishment_id)
  WHERE seen_at IS NULL;
