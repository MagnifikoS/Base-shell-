-- ═══════════════════════════════════════════════════════════════════════════
-- SYNC PROD → STAGING: Add missing schema items
-- ═══════════════════════════════════════════════════════════════════════════
-- These items exist in production but were created outside of tracked
-- migrations (likely via Supabase dashboard or Lovable). This migration
-- ensures staging matches prod exactly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. CREATE TABLE: supplier_name_aliases
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_name_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_raw     text NOT NULL,
  alias_norm    text NOT NULL,
  confidence    numeric NOT NULL DEFAULT 0.8,
  hit_count     integer NOT NULL DEFAULT 1,
  source        text NOT NULL DEFAULT 'auto_confirmed',
  supplier_id   uuid NOT NULL REFERENCES public.invoice_suppliers(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_supplier_name_aliases_alias_norm
  ON public.supplier_name_aliases (alias_norm, establishment_id);
CREATE INDEX IF NOT EXISTS idx_supplier_name_aliases_supplier
  ON public.supplier_name_aliases (supplier_id);

-- RLS: standard establishment-scoped pattern
ALTER TABLE public.supplier_name_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_name_aliases_select"
  ON public.supplier_name_aliases FOR SELECT
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "supplier_name_aliases_insert"
  ON public.supplier_name_aliases FOR INSERT
  WITH CHECK (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "supplier_name_aliases_update"
  ON public.supplier_name_aliases FOR UPDATE
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue
      WHERE ue.user_id = auth.uid()
    )
  );

CREATE POLICY "supplier_name_aliases_delete"
  ON public.supplier_name_aliases FOR DELETE
  USING (
    establishment_id IN (
      SELECT ue.establishment_id FROM public.user_establishments ue
      WHERE ue.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ALTER TABLE: establishments — add planning auto-publish columns
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'establishments'
      AND column_name = 'planning_auto_publish_enabled'
  ) THEN
    ALTER TABLE public.establishments
      ADD COLUMN planning_auto_publish_enabled boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'establishments'
      AND column_name = 'planning_auto_publish_time'
  ) THEN
    ALTER TABLE public.establishments
      ADD COLUMN planning_auto_publish_time time WITHOUT TIME ZONE NOT NULL DEFAULT '18:00:00';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ALTER TABLE: planning_weeks — add week_invalidated_at
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'planning_weeks'
      AND column_name = 'week_invalidated_at'
  ) THEN
    ALTER TABLE public.planning_weeks
      ADD COLUMN week_invalidated_at timestamptz DEFAULT NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ALTER TABLE: supplier_extraction_profiles — add 8 metrics columns
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'alias_hit_rate'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN alias_hit_rate numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'code_coverage_ratio'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN code_coverage_ratio numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'header_is_image_likely'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN header_is_image_likely boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'layout_hint'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN layout_hint text DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'match_by_code_rate'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN match_by_code_rate numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'preferred_language'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN preferred_language text DEFAULT 'fr';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'total_invoice_count'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN total_invoice_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_extraction_profiles'
      AND column_name = 'vision_rescue_count'
  ) THEN
    ALTER TABLE public.supplier_extraction_profiles
      ADD COLUMN vision_rescue_count integer DEFAULT 0;
  END IF;
END $$;
