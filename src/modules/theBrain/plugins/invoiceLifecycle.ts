/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Plugin: Invoice Lifecycle (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Plugin pour marquer les factures annulées/supprimées (voided).
 * 
 * RÈGLES:
 * - Append-only (aucune suppression de brain_events)
 * - Fire-and-forget (jamais bloquant)
 * - Utilisé par les vues UI pour exclure les events liés à une facture supprimée
 * 
 * SUPPRESSION:
 * - Supprimer ce fichier
 * - Retirer les imports dans InvoiceList.tsx
 * - Retirer l'export dans index.ts
 * - L'app fonctionne identique
 * 
 * @see src/modules/theBrain/README.md
 */

import { brainSafeLog } from "../services/theBrainService";
import { BRAIN_SUBJECTS, BRAIN_ACTIONS } from "../constants";

/**
 * Log qu'une facture a été supprimée/archivée (voided)
 * 
 * Fire-and-forget, non-bloquant
 * Appelé lors de la suppression d'une facture par l'utilisateur
 * 
 * @param establishmentId - ID de l'établissement
 * @param invoiceId - ID de la facture supprimée
 */
export function logInvoiceVoided(
  establishmentId: string,
  invoiceId: string
): void {
  brainSafeLog({
    establishmentId,
    subject: BRAIN_SUBJECTS.INVOICE_LIFECYCLE,
    action: BRAIN_ACTIONS.VOIDED,
    context: {
      invoice_id: invoiceId,
    },
  });
}
