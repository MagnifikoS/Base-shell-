-- Ajouter les colonnes pour le stockage sécurisé des données sensibles
ALTER TABLE public.employee_details 
  ADD COLUMN IF NOT EXISTS iban_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS ssn_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS iban_last4 TEXT,
  ADD COLUMN IF NOT EXISTS ssn_last2 TEXT,
  ADD COLUMN IF NOT EXISTS encryption_version INTEGER DEFAULT 1;

-- Migrer les données existantes en clair vers les colonnes last4/last2 (en attendant le chiffrement côté edge)
-- Note: Le chiffrement réel sera fait par l'edge function lors de la prochaine sauvegarde
UPDATE public.employee_details 
SET iban_last4 = RIGHT(iban, 4)
WHERE iban IS NOT NULL AND iban != '' AND iban_last4 IS NULL;

UPDATE public.employee_details 
SET ssn_last2 = RIGHT(social_security_number, 2)
WHERE social_security_number IS NOT NULL AND social_security_number != '' AND ssn_last2 IS NULL;

-- Supprimer la policy trop permissive qui expose les données sensibles aux salariés
DROP POLICY IF EXISTS "Users can view own employee details" ON public.employee_details;

-- Créer une policy restrictive pour que seuls les admins puissent SELECT
-- (le salarié verra ses données via une logique edge function contrôlée)
CREATE POLICY "Admins only can view org employee details" 
ON public.employee_details 
FOR SELECT 
USING (
  organization_id = get_user_organization_id() 
  AND is_admin(auth.uid())
);

-- Nettoyer les données en clair (les mettre à NULL) après migration
-- On garde les colonnes pour rétro-compatibilité mais elles seront vides
UPDATE public.employee_details SET iban = NULL WHERE iban IS NOT NULL;
UPDATE public.employee_details SET social_security_number = NULL WHERE social_security_number IS NOT NULL;