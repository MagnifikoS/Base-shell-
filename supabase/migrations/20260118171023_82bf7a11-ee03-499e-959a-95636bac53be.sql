-- HOTFIX RLS Phase 3A : Suppression policy INSERT user sur personnel_leave_requests
-- Objectif : garder la table 100% admin-only (standby) jusqu'à Phase demandes via Edge

-- Supprimer la policy qui permet aux users d'insérer des demandes
DROP POLICY IF EXISTS "Users can insert own leave requests" ON public.personnel_leave_requests;

-- Vérification : les policies restantes doivent être :
-- 1. "Admins can view establishment leave requests" (SELECT) - admin + établissement
-- 2. "Admins can update establishment leave requests" (UPDATE) - admin + établissement  
-- 3. "Users can view own leave requests" (SELECT) - user voit ses propres demandes (lecture seule, OK)