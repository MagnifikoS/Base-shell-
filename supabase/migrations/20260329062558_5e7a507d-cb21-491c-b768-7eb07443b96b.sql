ALTER TABLE public.product_input_config
  ADD COLUMN reception_unit_chain jsonb DEFAULT NULL,
  ADD COLUMN internal_unit_chain jsonb DEFAULT NULL;