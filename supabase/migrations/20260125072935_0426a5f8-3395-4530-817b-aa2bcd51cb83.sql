-- ÉTAPE 33 — Marqueurs de déprécation V1 (COMMENT ONLY, no runtime change)

-- Marquer V1 comme DEPRECATED
COMMENT ON FUNCTION public.get_my_permissions() IS 
  'DEPRECATED (legacy). Kept temporarily for rollback/compat. Do not use in new code. Use public.get_my_permissions_v2(_establishment_id uuid).';

-- Documenter V2 comme source de vérité
COMMENT ON FUNCTION public.get_my_permissions_v2(uuid) IS 
  'RBAC per establishment (scoped + legacy global). Primary source of truth.';