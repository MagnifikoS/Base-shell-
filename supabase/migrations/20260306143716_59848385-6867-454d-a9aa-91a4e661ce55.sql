
-- DLC Alert Settings per establishment (global default + category overrides)
CREATE TABLE public.dlc_alert_settings (
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  default_warning_days INTEGER NOT NULL DEFAULT 3,
  category_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (establishment_id)
);

-- RLS
ALTER TABLE public.dlc_alert_settings ENABLE ROW LEVEL SECURITY;

-- Policy: users can read settings for their establishments
CREATE POLICY "Users can read own establishment DLC settings"
  ON public.dlc_alert_settings
  FOR SELECT
  TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));

-- Policy: users can insert/update settings for their establishments
CREATE POLICY "Users can upsert own establishment DLC settings"
  ON public.dlc_alert_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (establishment_id IN (SELECT public.get_user_establishment_ids()));

CREATE POLICY "Users can update own establishment DLC settings"
  ON public.dlc_alert_settings
  FOR UPDATE
  TO authenticated
  USING (establishment_id IN (SELECT public.get_user_establishment_ids()));
