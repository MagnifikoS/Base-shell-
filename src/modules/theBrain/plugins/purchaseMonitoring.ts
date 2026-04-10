/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Plugin: Purchase Monitoring (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Plugin isolé pour observer les achats validés (SSOT: purchase_line_items).
 * 
 * RÈGLES:
 * - Observation uniquement (aucune décision, aucune suggestion)
 * - Append-only events
 * - Fire-and-forget (jamais await, jamais bloquant)
 * - Source unique: données persistées dans purchase_line_items
 * - Aucun calcul métier
 * 
 * SUPPRESSION:
 * - Supprimer ce fichier
 * - Retirer les imports dans VisionAI.tsx
 * - Retirer l'export dans index.ts
 * - Retirer la constante dans constants.ts
 * - L'app fonctionne identique
 * 
 * @see src/modules/theBrain/README.md
 */

import { brainSafeLog } from "../services/theBrainService";
import { BRAIN_SUBJECTS, BRAIN_ACTIONS } from "../constants";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Données d'une ligne d'achat persistée (venant de purchase_line_items)
 * Ce sont les données APRÈS insertion DB réussie
 */
export interface PurchaseLineObservedParams {
  establishmentId: string;
  /** ID de la facture source (pour filtrage voided) */
  invoiceId: string;
  /** ID du produit (products_v2.id) — peut être null si non matché */
  productId: string | null;
  /** ID du fournisseur (invoice.supplier_id) */
  supplierId: string;
  /** Mois d'agrégation (YYYY-MM depuis invoice.invoice_date) */
  yearMonth: string;
  /** Quantité commandée brute (pas de conversion) */
  quantity: number | null;
  /** Unité de facturation — resolved from supplier_billing_unit_id at call site */
  unit: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log une observation d'achat (après persistance réussie)
 * 
 * Appelé UNIQUEMENT après:
 * - Facture validée
 * - Écriture DB réussie dans purchase_line_items
 * 
 * ⚠️ NE PAS appeler avant la persistance DB
 * ⚠️ NE PAS utiliser les données extractées brutes (ExtractedProductLine)
 * ⚠️ Source unique: purchase_line_items persistées
 */
export function logPurchaseObserved(params: PurchaseLineObservedParams): void {
  // Fire-and-forget : on log sans attendre
  brainSafeLog({
    establishmentId: params.establishmentId,
    subject: BRAIN_SUBJECTS.PURCHASE_MONITORING,
    action: BRAIN_ACTIONS.OBSERVED,
    context: {
      invoice_id: params.invoiceId,
      product_id: params.productId,
      supplier_id: params.supplierId,
      year_month: params.yearMonth,
      quantity: params.quantity,
      unit: params.unit,
    },
  });
}

/**
 * Log plusieurs observations d'achat en batch
 * 
 * Appelé après createPurchaseLines() succès pour traiter toutes les lignes
 * Fire-and-forget, non-bloquant
 */
export function logPurchaseLinesBatch(
  establishmentId: string,
  invoiceId: string,
  lines: Array<{
    productId: string | null;
    supplierId: string;
    yearMonth: string;
    quantity: number | null;
    unit: string | null;
  }>
): void {
  // Fire-and-forget pour chaque ligne
  for (const line of lines) {
    logPurchaseObserved({
      establishmentId,
      invoiceId,
      productId: line.productId,
      supplierId: line.supplierId,
      yearMonth: line.yearMonth,
      quantity: line.quantity,
      unit: line.unit,
    });
  }
}
