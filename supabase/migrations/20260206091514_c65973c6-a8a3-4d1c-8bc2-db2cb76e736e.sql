-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE FACTURES V1 — Ajout supplier_name textuel (sans module fournisseurs)
-- ═══════════════════════════════════════════════════════════════════════════

-- Ajouter les colonnes supplier_name et supplier_name_normalized
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS supplier_name text,
ADD COLUMN IF NOT EXISTS supplier_name_normalized text;

-- Créer un index sur supplier_name_normalized pour le regroupement
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_name_normalized 
ON public.invoices(establishment_id, supplier_name_normalized);

-- Fonction pour normaliser le nom fournisseur (lowercase + trim + suppression accents)
CREATE OR REPLACE FUNCTION public.normalize_supplier_name(raw_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT LOWER(
    TRIM(
      translate(
        COALESCE(raw_name, ''),
        'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
        'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
      )
    )
  );
$$;

-- Trigger pour calculer automatiquement supplier_name_normalized lors de l'insert/update
CREATE OR REPLACE FUNCTION public.fn_invoices_normalize_supplier_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.supplier_name IS NOT NULL AND NEW.supplier_name != '' THEN
    NEW.supplier_name_normalized := public.normalize_supplier_name(NEW.supplier_name);
  ELSE
    NEW.supplier_name_normalized := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Supprimer le trigger s'il existe déjà
DROP TRIGGER IF EXISTS trg_invoices_normalize_supplier_name ON public.invoices;

-- Créer le trigger
CREATE TRIGGER trg_invoices_normalize_supplier_name
BEFORE INSERT OR UPDATE OF supplier_name ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.fn_invoices_normalize_supplier_name();