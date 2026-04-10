-- Table des politiques de pause par établissement
CREATE TABLE public.establishment_break_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT false,
  input_text TEXT NOT NULL,
  policy_json JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- Index partiel unique : une seule règle active par établissement
CREATE UNIQUE INDEX idx_establishment_break_policies_active 
ON public.establishment_break_policies (establishment_id) 
WHERE is_active = true;

-- Index pour requêtes par établissement
CREATE INDEX idx_establishment_break_policies_establishment 
ON public.establishment_break_policies (establishment_id);

-- Trigger updated_at
CREATE TRIGGER update_establishment_break_policies_updated_at
BEFORE UPDATE ON public.establishment_break_policies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.establishment_break_policies ENABLE ROW LEVEL SECURITY;

-- RLS: Admins can do everything
CREATE POLICY "Admins can view break policies"
ON public.establishment_break_policies
FOR SELECT
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert break policies"
ON public.establishment_break_policies
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update break policies"
ON public.establishment_break_policies
FOR UPDATE
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete break policies"
ON public.establishment_break_policies
FOR DELETE
USING (is_admin(auth.uid()));