
-- Fix security definer views: set to INVOKER so RLS applies
ALTER VIEW public.v_b2b_coherence_triangulation SET (security_invoker = on);
ALTER VIEW public.v_b2b_coherence_reconciliation SET (security_invoker = on);
ALTER VIEW public.v_b2b_coherence_vat_orphans SET (security_invoker = on);
