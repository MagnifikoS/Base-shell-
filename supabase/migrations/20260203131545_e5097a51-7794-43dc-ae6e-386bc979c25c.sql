-- Add is_paid column to invoices table
ALTER TABLE public.invoices 
ADD COLUMN is_paid boolean NOT NULL DEFAULT false;