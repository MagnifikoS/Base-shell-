ALTER TABLE public.product_orders
DROP CONSTRAINT IF EXISTS product_orders_status_check;

ALTER TABLE public.product_orders
ADD CONSTRAINT product_orders_status_check
CHECK (
  status = ANY (
    ARRAY[
      'draft'::text,
      'sent'::text,
      'preparing'::text,
      'prepared'::text,
      'shipped'::text,
      'awaiting_client_validation'::text,
      'received'::text,
      'closed'::text
    ]
  )
);