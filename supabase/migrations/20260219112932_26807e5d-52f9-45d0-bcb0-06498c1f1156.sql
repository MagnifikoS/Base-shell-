
-- Ajout des colonnes installments sur pay_supplier_rules
-- installment_count : nombre de paiements (2..5)
-- installment_days  : tableau des jours du mois (1-28), ex: {5, 15, 25}
ALTER TABLE public.pay_supplier_rules
  ADD COLUMN IF NOT EXISTS installment_count integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS installment_days  integer[] DEFAULT NULL;

-- Contrainte : si mode=installments, installment_count doit être renseigné
-- Validation dans le trigger existant fn_pay_supplier_rules_validate
CREATE OR REPLACE FUNCTION public.fn_pay_supplier_rules_validate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.mode NOT IN ('none', 'manual_transfer', 'direct_debit_delay', 'direct_debit_fixed_day', 'installments') THEN
    RAISE EXCEPTION 'pay_supplier_rules.mode invalid';
  END IF;
  IF NEW.allocation_strategy NOT IN ('fifo_oldest', 'current_month_first', 'manual') THEN
    RAISE EXCEPTION 'pay_supplier_rules.allocation_strategy invalid';
  END IF;
  IF NEW.mode = 'direct_debit_delay' AND NEW.delay_days IS NULL THEN
    RAISE EXCEPTION 'delay_days required when mode = direct_debit_delay';
  END IF;
  IF NEW.mode = 'direct_debit_fixed_day' AND NEW.fixed_day_of_month IS NULL THEN
    RAISE EXCEPTION 'fixed_day_of_month required when mode = direct_debit_fixed_day';
  END IF;
  IF NEW.fixed_day_of_month IS NOT NULL AND (NEW.fixed_day_of_month < 1 OR NEW.fixed_day_of_month > 28) THEN
    RAISE EXCEPTION 'fixed_day_of_month must be between 1 and 28';
  END IF;
  -- Validation installments
  IF NEW.mode = 'installments' THEN
    IF NEW.installment_count IS NULL OR NEW.installment_count < 2 OR NEW.installment_count > 5 THEN
      RAISE EXCEPTION 'installment_count must be between 2 and 5 when mode = installments';
    END IF;
    IF NEW.installment_days IS NULL OR array_length(NEW.installment_days, 1) != NEW.installment_count THEN
      RAISE EXCEPTION 'installment_days must have exactly installment_count elements';
    END IF;
    -- Vérifie que chaque jour est entre 1 et 28
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.installment_days) AS d WHERE d < 1 OR d > 28
    ) THEN
      RAISE EXCEPTION 'All installment_days must be between 1 and 28';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
