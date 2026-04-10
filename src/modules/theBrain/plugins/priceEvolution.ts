/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Plugin: Price Evolution (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Plugin isolé pour observer l'évolution des prix des produits.
 *
 * RÈGLES:
 * - Observation uniquement (aucune décision, aucune alerte)
 * - Fire-and-forget (jamais await bloquant côté caller)
 * - Prix facturé calculé: line_total / quantite_commandee
 * - Prix référence: products_v2.final_unit_price (batch query, non-bloquant)
 * - Si la requête échoue → reference_price: null (log partiel OK)
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

import { supabase } from "@/integrations/supabase/client";
import { brainSafeLog } from "../services/theBrainService";
import { BRAIN_SUBJECTS, BRAIN_ACTIONS, THE_BRAIN_DISABLED } from "../constants";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Données d'une ligne pour l'observation de prix
 */
export interface PriceEvolutionLineParams {
  /** ID de la facture source (pour filtrage voided) */
  invoiceId: string;
  /** ID du produit (products_v2.id) — obligatoire pour ce sujet */
  productId: string;
  /** ID du fournisseur (invoice.supplier_id) */
  supplierId: string;
  /** Mois d'agrégation (YYYY-MM depuis invoice.invoice_date) */
  yearMonth: string;
  /** Quantité commandée (pour calcul prix unitaire) */
  quantity: number;
  /** Total ligne (pour calcul prix unitaire) */
  lineTotal: number;
  /** Unité de facturation (info) */
  unit: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL: Fetch reference prices (batch, non-blocking)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère les prix de référence depuis products_v2 en batch
 * Non-bloquant: si erreur, retourne map vide
 */
async function fetchReferencePrices(productIds: string[]): Promise<Map<string, number | null>> {
  const priceMap = new Map<string, number | null>();

  if (productIds.length === 0) {
    return priceMap;
  }

  try {
    const { data, error } = await supabase
      .from("products_v2")
      .select("id, final_unit_price")
      .in("id", productIds);

    if (error) {
      if (import.meta.env.DEV)
        console.warn("[priceEvolution] Fetch reference prices failed:", error.message);
      return priceMap;
    }

    if (data) {
      for (const product of data) {
        priceMap.set(product.id, product.final_unit_price);
      }
    }
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn("[priceEvolution] Unexpected error fetching prices:", err);
  }

  return priceMap;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log plusieurs observations de prix en batch
 *
 * Appelé après createPurchaseLines() succès, au même point que purchase_monitoring
 *
 * Fire-and-forget:
 * - Fetch batch des reference_price depuis products_v2
 * - Log chaque ligne avec unit_price calculé
 * - Si erreur fetch → log avec reference_price: null
 * - Jamais bloquant pour le workflow facture
 *
 * @param establishmentId - ID de l'établissement
 * @param lines - Lignes avec productId matché, quantity et lineTotal connus
 */
export function logPriceEvolutionBatch(
  establishmentId: string,
  invoiceId: string,
  lines: PriceEvolutionLineParams[]
): void {
  // Check global toggle
  if (THE_BRAIN_DISABLED) {
    return;
  }

  // Filter lines that can compute unit_price (productId + quantity > 0 + lineTotal)
  const validLines = lines.filter(
    (line) =>
      line.productId &&
      line.quantity !== null &&
      line.quantity > 0 &&
      line.lineTotal !== null &&
      line.lineTotal > 0
  );

  if (validLines.length === 0) {
    return;
  }

  // Fire-and-forget async processing
  (async () => {
    try {
      // Extract unique product IDs
      const productIds = [...new Set(validLines.map((l) => l.productId))];

      // Batch fetch reference prices (non-blocking, errors handled internally)
      const referencePrices = await fetchReferencePrices(productIds);

      // Log each observation
      for (const line of validLines) {
        const unitPrice = line.lineTotal / line.quantity;
        const referencePrice = referencePrices.get(line.productId) ?? null;

        brainSafeLog({
          establishmentId,
          subject: BRAIN_SUBJECTS.PRICE_EVOLUTION,
          action: BRAIN_ACTIONS.OBSERVED,
          context: {
            invoice_id: line.invoiceId,
            product_id: line.productId,
            supplier_id: line.supplierId,
            year_month: line.yearMonth,
            unit_price: unitPrice,
            reference_price: referencePrice,
            unit: line.unit,
          },
        });
      }
    } catch (err) {
      // Never crash, never block - just warn
      if (import.meta.env.DEV) console.warn("[priceEvolution] Batch logging failed:", err);
    }
  })();
}
