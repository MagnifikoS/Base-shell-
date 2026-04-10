-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE: Congés & Absences (Phase 1)
-- Seed module + Add justificatif column + RLS policies for self access
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Seed module key (idempotent)
INSERT INTO public.modules (key, name, display_order)
VALUES ('conges_absences', 'Congés & Absences', 95)
ON CONFLICT (key) DO NOTHING;

-- 2. Add justificatif_document_id column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'personnel_leaves' 
    AND column_name = 'justificatif_document_id'
  ) THEN
    ALTER TABLE public.personnel_leaves 
    ADD COLUMN justificatif_document_id uuid NULL;
  END IF;
END $$;

-- 3. RLS Policy: INSERT self for conges_absences module
-- Allows employees to declare their own absences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'personnel_leaves' 
    AND policyname = 'conges_absences_insert_self'
  ) THEN
    CREATE POLICY conges_absences_insert_self ON public.personnel_leaves
    FOR INSERT
    WITH CHECK (
      user_id = auth.uid()
      AND has_module_access('conges_absences', 'write', establishment_id)
    );
  END IF;
END $$;

-- 4. RLS Policy: SELECT self for conges_absences module  
-- Allows employees to view their own absences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'personnel_leaves' 
    AND policyname = 'conges_absences_select_self'
  ) THEN
    CREATE POLICY conges_absences_select_self ON public.personnel_leaves
    FOR SELECT
    USING (
      user_id = auth.uid()
      AND has_module_access('conges_absences', 'read', establishment_id)
    );
  END IF;
END $$;