/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — Helper pour créer les lignes d'achat depuis Vision AI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Transforme les données Vision AI en lignes d'achat persistables.
 * Utilisé après la validation de la facture.
 *
 * RÈGLES:
 * - Pas de conversion de quantité (quantite_commandee brut)
 * - product_id depuis matchProductV2 ou confirmedMatches
 * - year_month dérivé de invoice_date (SSOT obligatoire)
 */

import type { Invoice } from "@/modules/factures";
import type { CreatePurchaseLineInput } from "../types";

/**
 * Ligne résolue avec product_id final (auto-match ou confirmé)
 */
export interface ResolvedProductLine {
  /** UI line identifier (_id from EditableProductLine) */
  sourceLineId: string;
  /** Final product_id (from matchProductV2 or confirmedMatches) */
  productId: string | null;
  /** Raw billed quantity (null if missing) */
  quantiteCommandee: number | null;
  /** Line total price (null if missing) */
  lineTotalPrice: number | null;
  /** Product code snapshot */
  productCodeSnapshot: string | null;
  /** Product name snapshot */
  productNameSnapshot: string;
  /** Unit extracted by AI (informational only) */
  unitSnapshot: string | null;
}

/**
 * Transformer les lignes résolues + invoice en inputs pour purchase_line_items
 */
export function buildPurchaseLineInputs(
  invoice: Invoice,
  resolvedLines: ResolvedProductLine[]
): CreatePurchaseLineInput[] {
  // Derive year_month from invoice_date (YYYY-MM-DD → YYYY-MM)
  const yearMonth = invoice.invoice_date.substring(0, 7);

  if (!yearMonth || yearMonth.length !== 7) {
    if (import.meta.env.DEV)
      console.error("[buildPurchaseLineInputs] Invalid invoice_date format:", invoice.invoice_date);
    return [];
  }

  return resolvedLines.map((line) => ({
    invoice_id: invoice.id,
    establishment_id: invoice.establishment_id,
    supplier_id: invoice.supplier_id,
    year_month: yearMonth,
    source_line_id: line.sourceLineId,
    product_id: line.productId,
    quantite_commandee: line.quantiteCommandee,
    line_total: line.lineTotalPrice,
    product_code_snapshot: line.productCodeSnapshot,
    product_name_snapshot: line.productNameSnapshot,
    unit_snapshot: line.unitSnapshot,
  }));
}
