-- Enable realtime for BL withdrawal tables (Commande Produits P1)
ALTER PUBLICATION supabase_realtime ADD TABLE public.bl_withdrawal_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bl_withdrawal_lines;