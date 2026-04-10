-- =============================================
-- TABLE: employee_details
-- Stocke les informations personnelles et contractuelles des salariés
-- =============================================

CREATE TABLE public.employee_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  
  -- Informations personnelles (KYC ready)
  phone TEXT,
  address TEXT,
  position TEXT,
  
  -- Pièce d'identité
  id_type TEXT, -- 'passport', 'national_id', 'driver_license', 'residence_permit'
  id_issue_date DATE,
  id_expiry_date DATE,
  
  -- Informations administratives
  social_security_number TEXT,
  iban TEXT,
  
  -- Contrat
  contract_type TEXT, -- 'CDI', 'CDD', 'interim', 'apprenticeship', 'internship'
  contract_start_date DATE,
  contract_hours NUMERIC(5,2), -- Heures hebdomadaires
  gross_salary NUMERIC(10,2),
  net_salary NUMERIC(10,2),
  contract_end_date DATE, -- Renseigné lors de la fin de contrat
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_details ENABLE ROW LEVEL SECURITY;

-- Index pour performance du filtre par organisation
CREATE INDEX idx_employee_details_organization ON public.employee_details(organization_id);

-- Index pour jointures sur user_id
CREATE INDEX idx_employee_details_user_id ON public.employee_details(user_id);

-- =============================================
-- RLS POLICIES
-- =============================================

-- Les salariés peuvent voir leurs propres détails
CREATE POLICY "Users can view own employee details"
ON public.employee_details
FOR SELECT
USING (user_id = auth.uid());

-- Les admins peuvent voir tous les détails de leur org
CREATE POLICY "Admins can view org employee details"
ON public.employee_details
FOR SELECT
USING (organization_id = get_user_organization_id() AND is_admin(auth.uid()));

-- Les admins peuvent créer des détails pour leur org
CREATE POLICY "Admins can insert org employee details"
ON public.employee_details
FOR INSERT
WITH CHECK (organization_id = get_user_organization_id() AND is_admin(auth.uid()));

-- Les admins peuvent modifier les détails de leur org
CREATE POLICY "Admins can update org employee details"
ON public.employee_details
FOR UPDATE
USING (organization_id = get_user_organization_id() AND is_admin(auth.uid()));

-- =============================================
-- TRIGGER: updated_at
-- =============================================

CREATE TRIGGER update_employee_details_updated_at
BEFORE UPDATE ON public.employee_details
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- INDEX PERFORMANCE: filtre établissement (recommandation précédente)
-- =============================================

-- Index sur user_establishments(establishment_id) pour le filtrage par établissement
CREATE INDEX IF NOT EXISTS idx_user_establishments_establishment_id 
ON public.user_establishments(establishment_id);

-- Index sur invitations(establishment_id) pour le filtrage par établissement  
CREATE INDEX IF NOT EXISTS idx_invitations_establishment_id 
ON public.invitations(establishment_id);