-- Table pour les parties de journée par établissement
CREATE TABLE public.establishment_day_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  part text NOT NULL CHECK (part IN ('morning', 'midday', 'evening')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, part)
);

-- Enable RLS
ALTER TABLE public.establishment_day_parts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view all day parts"
ON public.establishment_day_parts
FOR SELECT
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert day parts"
ON public.establishment_day_parts
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update day parts"
ON public.establishment_day_parts
FOR UPDATE
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete day parts"
ON public.establishment_day_parts
FOR DELETE
USING (is_admin(auth.uid()));

CREATE POLICY "Users can view day parts for assigned establishments"
ON public.establishment_day_parts
FOR SELECT
USING (establishment_id IN (SELECT get_user_establishment_ids()));

-- Trigger pour updated_at
CREATE TRIGGER update_establishment_day_parts_updated_at
BEFORE UPDATE ON public.establishment_day_parts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();