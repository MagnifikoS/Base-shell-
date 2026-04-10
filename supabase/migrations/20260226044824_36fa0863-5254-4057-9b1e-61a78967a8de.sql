
-- Add order_number column with auto-increment sequence per establishment
CREATE SEQUENCE IF NOT EXISTS public.product_orders_order_number_seq;

ALTER TABLE public.product_orders 
  ADD COLUMN order_number INT DEFAULT nextval('public.product_orders_order_number_seq');

-- Backfill existing orders with sequential numbers based on created_at
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.product_orders
)
UPDATE public.product_orders po
SET order_number = numbered.rn
FROM numbered
WHERE po.id = numbered.id;
