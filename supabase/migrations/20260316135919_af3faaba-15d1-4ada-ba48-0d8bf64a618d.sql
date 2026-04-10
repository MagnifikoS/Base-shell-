
ALTER TABLE public.cash_day_reports
  ADD COLUMN IF NOT EXISTS advance_eur numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_employee_id uuid REFERENCES public.profiles(user_id) DEFAULT NULL;
