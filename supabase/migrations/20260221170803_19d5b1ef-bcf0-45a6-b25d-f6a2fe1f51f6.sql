
ALTER TABLE public.mep_orders ADD COLUMN status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.mep_orders ADD COLUMN validated_at timestamptz;
ALTER TABLE public.mep_orders ADD COLUMN validated_by uuid;
