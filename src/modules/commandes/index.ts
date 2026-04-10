/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE COMMANDES — Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Module de gestion des commandes fournisseurs B2B.
 * Isolé et activable/désactivable par établissement.
 *
 * RULES:
 * - Module autonome (pages + composants + services + hooks)
 * - Dépendances minimales : supabase client, UI components, UniversalQuantityModal
 * - Si module OFF → aucune route / aucun item sidebar
 * - Si module ON → routes et UI accessibles
 *
 * SUPPRESSION COMPLÈTE:
 * 1. Supprimer src/modules/commandes/
 * 2. Supprimer la route dans AppRoutes.tsx
 * 3. Supprimer l'entrée dans navRegistry.ts + sidebarSections.ts
 * 4. DROP TABLE commande_lines; DROP TABLE commandes; DROP TYPE commande_status;
 * 5. DROP FUNCTION fn_send_commande, fn_open_commande;
 * 6. Supprimer supabase/functions/commandes-api/
 * 7. Supprimer [functions.commandes-api] dans config.toml
 */

export { ReceptionDialog } from "./components/ReceptionDialog";
export type { ReceptionValidationState } from "./components/ReceptionDialog";
