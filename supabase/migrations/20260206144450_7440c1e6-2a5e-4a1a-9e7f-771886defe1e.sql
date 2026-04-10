-- Add info_produit column to products table for storing extracted product metadata
ALTER TABLE public.products 
ADD COLUMN info_produit text;