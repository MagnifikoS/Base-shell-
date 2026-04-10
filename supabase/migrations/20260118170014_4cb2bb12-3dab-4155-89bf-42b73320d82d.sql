-- =====================================================
-- PHASE 3A: Tables RH "Absences & CP planifiés"
-- Source unique RH, isolée, admin-only + établissement
-- =====================================================

-- Table 1: personnel_leaves (source RH officielle)
CREATE TABLE public.personnel_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  leave_date date NOT NULL,
  leave_type text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  reason text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Contraintes CHECK (enum-like)
  CONSTRAINT personnel_leaves_type_check CHECK (leave_type IN ('absence', 'cp')),
  CONSTRAINT personnel_leaves_status_check CHECK (status IN ('approved', 'cancelled'))
);

-- Table 2: personnel_leave_requests (standby pour futures demandes salariés)
CREATE TABLE public.personnel_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  leave_date date NOT NULL,
  leave_type text NOT NULL,
  reason text NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Contraintes CHECK
  CONSTRAINT personnel_leave_requests_type_check CHECK (leave_type IN ('absence', 'cp')),
  CONSTRAINT personnel_leave_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

-- =====================================================
-- INDEXES (performance + anti-doublon)
-- =====================================================

-- Anti-doublon: un salarié ne peut avoir 2 leaves approved le même jour
CREATE UNIQUE INDEX idx_personnel_leaves_unique_approved 
ON public.personnel_leaves (establishment_id, user_id, leave_date) 
WHERE status = 'approved';

-- Performance: filtrage par établissement + date (paie, planning)
CREATE INDEX idx_personnel_leaves_estab_date 
ON public.personnel_leaves (establishment_id, leave_date);

-- Performance: filtrage par salarié
CREATE INDEX idx_personnel_leaves_estab_user_date 
ON public.personnel_leaves (establishment_id, user_id, leave_date);

-- Indexes pour requests
CREATE INDEX idx_personnel_leave_requests_estab_status_date 
ON public.personnel_leave_requests (establishment_id, status, leave_date);

CREATE INDEX idx_personnel_leave_requests_estab_user_date 
ON public.personnel_leave_requests (establishment_id, user_id, leave_date);

-- =====================================================
-- RLS: Admin-only + Établissement (pattern existant)
-- =====================================================

-- Activer RLS
ALTER TABLE public.personnel_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personnel_leave_requests ENABLE ROW LEVEL SECURITY;

-- personnel_leaves: Admin uniquement, scoped par établissement
CREATE POLICY "Admins can view establishment leaves"
ON public.personnel_leaves
FOR SELECT
USING (
  is_admin(auth.uid()) 
  AND establishment_id IN (SELECT get_user_establishment_ids())
);

CREATE POLICY "Admins can insert establishment leaves"
ON public.personnel_leaves
FOR INSERT
WITH CHECK (
  is_admin(auth.uid()) 
  AND establishment_id IN (SELECT get_user_establishment_ids())
);

CREATE POLICY "Admins can update establishment leaves"
ON public.personnel_leaves
FOR UPDATE
USING (
  is_admin(auth.uid()) 
  AND establishment_id IN (SELECT get_user_establishment_ids())
);

CREATE POLICY "Admins can delete establishment leaves"
ON public.personnel_leaves
FOR DELETE
USING (
  is_admin(auth.uid()) 
  AND establishment_id IN (SELECT get_user_establishment_ids())
);

-- personnel_leave_requests: Salariés peuvent créer leurs demandes
CREATE POLICY "Users can insert own leave requests"
ON public.personnel_leave_requests
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- personnel_leave_requests: Admin uniquement pour lecture/update
CREATE POLICY "Admins can view establishment leave requests"
ON public.personnel_leave_requests
FOR SELECT
USING (
  is_admin(auth.uid()) 
  AND establishment_id IN (SELECT get_user_establishment_ids())
);

CREATE POLICY "Admins can update establishment leave requests"
ON public.personnel_leave_requests
FOR UPDATE
USING (
  is_admin(auth.uid()) 
  AND establishment_id IN (SELECT get_user_establishment_ids())
);

-- Users can view their own requests
CREATE POLICY "Users can view own leave requests"
ON public.personnel_leave_requests
FOR SELECT
USING (user_id = auth.uid());

-- Trigger updated_at pour personnel_leaves
CREATE TRIGGER update_personnel_leaves_updated_at
BEFORE UPDATE ON public.personnel_leaves
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();