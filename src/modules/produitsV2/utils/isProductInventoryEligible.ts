/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2 — isProductInventoryEligible (pure function, shared SSOT)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Central eligibility rule — used by:
 * - Mobile inventory (CountingModal, ZoneSelector)
 * - Desktop inventory (DesktopInventoryView)
 * - Product detail page (red banner)
 * - "Produits à configurer" screen
 *
 * RULES:
 * R1: storage_zone_id != null
 * R2: stock_handling_unit_id != null
 * R3: unitContext.needsConfiguration === false
 * R4: unitContext.hasStaleStockHandlingUnit === false
 * R5: archived_at == null
 * R6: unitContext resolution valid (non-null canonical)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ProductUnitContext } from "@/core/unitConversion/resolveProductUnitContext";

export type EligibilityReason =
  | "MISSING_STORAGE_ZONE"
  | "MISSING_STOCK_HANDLING_UNIT"
  | "NEEDS_CONFIGURATION"
  | "STALE_STOCK_HANDLING_UNIT"
  | "ARCHIVED_PRODUCT"
  | "MISSING_CANONICAL_CONTEXT";

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
}

/** Minimal product shape needed for eligibility check */
export interface EligibilityProductInput {
  storage_zone_id: string | null;
  stock_handling_unit_id: string | null;
  archived_at: string | null;
}

/**
 * Pure function — no side effects, no DB, no hooks.
 * Call resolveProductUnitContext() separately and pass the result here.
 */
export function isProductInventoryEligible(
  product: EligibilityProductInput,
  unitContext: ProductUnitContext | null
): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  // R5: Archived product
  if (product.archived_at != null) {
    reasons.push("ARCHIVED_PRODUCT");
  }

  // R1: Missing storage zone
  if (!product.storage_zone_id) {
    reasons.push("MISSING_STORAGE_ZONE");
  }

  // R2: Missing stock handling unit
  if (!product.stock_handling_unit_id) {
    reasons.push("MISSING_STOCK_HANDLING_UNIT");
  }

  // R6: Unit context could not be resolved
  if (!unitContext || !unitContext.canonicalInventoryUnitId) {
    reasons.push("MISSING_CANONICAL_CONTEXT");
    return { eligible: false, reasons };
  }

  // R3: Needs configuration
  if (unitContext.needsConfiguration) {
    reasons.push("NEEDS_CONFIGURATION");
  }

  // R4: Stale stock handling unit
  if (unitContext.hasStaleStockHandlingUnit) {
    reasons.push("STALE_STOCK_HANDLING_UNIT");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

/** Human-readable labels for each reason (French) */
export const ELIGIBILITY_REASON_LABELS: Record<EligibilityReason, string> = {
  MISSING_STORAGE_ZONE: "Zone de stockage manquante",
  MISSING_STOCK_HANDLING_UNIT: "Unité de gestion stock manquante",
  NEEDS_CONFIGURATION: "Configuration conditionnement incomplète",
  STALE_STOCK_HANDLING_UNIT: "Unité de gestion stock incohérente (stale)",
  ARCHIVED_PRODUCT: "Produit archivé",
  MISSING_CANONICAL_CONTEXT: "Contexte d'unité canonique invalide",
};
