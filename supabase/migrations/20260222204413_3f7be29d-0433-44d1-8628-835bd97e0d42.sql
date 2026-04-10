-- Enable realtime for product_orders and product_order_lines
ALTER PUBLICATION supabase_realtime ADD TABLE public.product_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.product_order_lines;