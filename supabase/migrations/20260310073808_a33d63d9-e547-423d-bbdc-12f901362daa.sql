CREATE UNIQUE INDEX uq_return_line_type
ON public.product_returns (commande_line_id, return_type)
WHERE commande_line_id IS NOT NULL AND status != 'refused';