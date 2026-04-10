-- TABLE 1: Horaires hebdomadaires standards
CREATE TABLE public.establishment_opening_hours (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 1 AND day_of_week <= 7),
  open_time TIME,
  close_time TIME,
  closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, day_of_week)
);

-- TABLE 2: Exceptions de dates
CREATE TABLE public.establishment_opening_exceptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  open_time TIME,
  close_time TIME,
  closed BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, date)
);

-- Enable RLS
ALTER TABLE public.establishment_opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.establishment_opening_exceptions ENABLE ROW LEVEL SECURITY;

-- RLS: Admins can do everything on opening hours
CREATE POLICY "Admins can view establishment hours"
ON public.establishment_opening_hours
FOR SELECT
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert establishment hours"
ON public.establishment_opening_hours
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update establishment hours"
ON public.establishment_opening_hours
FOR UPDATE
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete establishment hours"
ON public.establishment_opening_hours
FOR DELETE
USING (is_admin(auth.uid()));

-- RLS: Admins can do everything on exceptions
CREATE POLICY "Admins can view establishment exceptions"
ON public.establishment_opening_exceptions
FOR SELECT
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert establishment exceptions"
ON public.establishment_opening_exceptions
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update establishment exceptions"
ON public.establishment_opening_exceptions
FOR UPDATE
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete establishment exceptions"
ON public.establishment_opening_exceptions
FOR DELETE
USING (is_admin(auth.uid()));

-- Users can view hours for their assigned establishments (for Planning later)
CREATE POLICY "Users can view hours for assigned establishments"
ON public.establishment_opening_hours
FOR SELECT
USING (establishment_id IN (SELECT get_user_establishment_ids()));

CREATE POLICY "Users can view exceptions for assigned establishments"
ON public.establishment_opening_exceptions
FOR SELECT
USING (establishment_id IN (SELECT get_user_establishment_ids()));

-- Triggers for updated_at
CREATE TRIGGER update_establishment_opening_hours_updated_at
BEFORE UPDATE ON public.establishment_opening_hours
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_establishment_opening_exceptions_updated_at
BEFORE UPDATE ON public.establishment_opening_exceptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();