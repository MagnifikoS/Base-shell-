-- =============================================
-- PHASE CP TRANSITOIRE - Migration minimale
-- Ajoute cp_n et cp_n1 sur employee_details
-- =============================================

-- Ajouter les champs CP transitoires (nullable, valeurs libres)
ALTER TABLE public.employee_details
  ADD COLUMN IF NOT EXISTS cp_n1 numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cp_n numeric DEFAULT NULL;

-- Commentaires pour documentation
COMMENT ON COLUMN public.employee_details.cp_n1 IS 'CP N-1 : reliquat année précédente (saisi manuellement, transitoire)';
COMMENT ON COLUMN public.employee_details.cp_n IS 'CP N : droits année en cours (saisi manuellement, transitoire)';