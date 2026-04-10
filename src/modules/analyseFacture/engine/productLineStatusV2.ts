/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT LINE STATUS ENGINE (V2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Determines the status (🟢/🟠) for each extracted product line.
 *
 * STATUSES:
 * 🟢 GREEN (validated): Product known → auto-validated
 * 🟠 ORANGE (needs_action): Unknown product OR uncertain match OR incomplete
 *
 * NOTE: Price comparison (🔴 price_alert) has been removed.
 * Matched products are now directly validated without price checks.
 */

import type { ExtractedProductLine } from "@/modules/shared";
import type { ProductV2 } from "@/modules/produitsV2";
import { matchProductV2, type MatchResult } from "./matchProductV2";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type LineStatus = "validated" | "needs_action";

export interface LineStatusResult {
  /** Primary status */
  status: LineStatus;

  /** Status label for UI */
  label: string;

  /** Match result (if any) */
  matchResult: MatchResult;

  /** Price comparison result — REMOVED, always null */
  priceResult: null;

  /** Matched V2 product (shortcut) */
  matchedProduct: ProductV2 | null;

  /** Requires human decision? */
  requiresDecision: boolean;

  /** Can be auto-validated? */
  canAutoValidate: boolean;

  /** Reason for status */
  reason: string;

  /** Actions available */
  availableActions: LineAction[];
}

export type LineAction =
  | "create_product" // 🟠 Create new product via V3 wizard
  | "select_existing" // 🟠 Select from existing products (Phase 1 suggestions / THE BRAIN)
  | "complete_config" // 🟠 Complete conditioning config
  | "none"; // 🟢 No action needed

// ═══════════════════════════════════════════════════════════════════════════
// TYPES FOR CONFIRMED MATCHES
// ═══════════════════════════════════════════════════════════════════════════

/** Match confirmé par l'utilisateur (fuzzy → exact) */
export interface ConfirmedMatch {
  productId: string;
  confirmedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Process exact match → directly validated (no price comparison)
// ═══════════════════════════════════════════════════════════════════════════

function processExactMatch(
  _item: ExtractedProductLine,
  matchedProduct: ProductV2,
  matchResult: MatchResult
): LineStatusResult {
  // Matched product → directly validated (price comparison removed)
  return {
    status: "validated",
    label: "Validé",
    matchResult,
    priceResult: null,
    matchedProduct,
    requiresDecision: false,
    canAutoValidate: true,
    reason: "Produit reconnu",
    availableActions: ["none"],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine status for an extracted product line
 * @param confirmedProductId - If user confirmed a fuzzy match, this is the confirmed product ID
 */
export function determineLineStatus(
  item: ExtractedProductLine,
  productsV2: ProductV2[],
  lineIndex?: number,
  confirmedProductId?: string
): LineStatusResult {
  const hasCodeProduit = item.code_produit && item.code_produit.trim().length > 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY CHECK: User confirmed a fuzzy match → treat as exact match
  // ═══════════════════════════════════════════════════════════════════════════

  if (confirmedProductId) {
    const confirmedProduct = productsV2.find((p) => p.id === confirmedProductId);
    if (confirmedProduct) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[lineStatus] 🔒 CONFIRMED MATCH", {
          lineIndex,
          confirmedProductId,
          productName: confirmedProduct.nom_produit,
        });
      }

      return processExactMatch(item, confirmedProduct, {
        isNew: false,
        isExact: true,
        match: {
          product: confirmedProduct,
          matchType: "name_exact",
          confidence: 100,
        },
        alternatives: [],
      });
    }
  }

  // Step 1: Match against V2 products
  const matchResult = matchProductV2(item.code_produit, item.nom_produit_complet, productsV2);

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 1a: Code present but NOT found → 🟠 NEEDS_ACTION (code unknown)
  // ═══════════════════════════════════════════════════════════════════════════

  if (hasCodeProduit && matchResult.isNew) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[lineStatus] 🟠 CODE NOT FOUND", {
        lineIndex,
        extractedCode: item.code_produit,
        extractedName: item.nom_produit_complet,
      });
    }

    return {
      status: "needs_action",
      label: "Nouveau produit",
      matchResult,
      priceResult: null,
      matchedProduct: null,
      requiresDecision: true,
      canAutoValidate: false,
      reason: `Code produit "${item.code_produit}" non trouvé dans les Produits`,
      availableActions: ["create_product"],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 1b: No code & no match → 🟠 NEEDS_ACTION (new product)
  // ═══════════════════════════════════════════════════════════════════════════

  if (matchResult.isNew) {
    return {
      status: "needs_action",
      label: "Nouveau produit",
      matchResult,
      priceResult: null,
      matchedProduct: null,
      requiresDecision: true,
      canAutoValidate: false,
      reason: "Produit non trouvé dans la base V2",
      availableActions: ["select_existing", "create_product"],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 2: Exact match → Directly validated (no price comparison)
  // ═══════════════════════════════════════════════════════════════════════════

  const matchedProduct = matchResult.match!.product;
  return processExactMatch(item, matchedProduct, matchResult);
}

/**
 * Process all extracted items and determine their statuses
 * @param confirmedMatches - Map of item IDs to confirmed product IDs
 */
export function determineAllLineStatuses(
  items: ExtractedProductLine[],
  productsV2: ProductV2[],
  confirmedMatches: Record<string, ConfirmedMatch> = {}
): Map<number, LineStatusResult> {
  const results = new Map<number, LineStatusResult>();

  items.forEach((item, index) => {
    const itemKey = (item as { _id?: string })._id;
    const confirmedMatch = itemKey ? confirmedMatches[itemKey] : undefined;
    const confirmedProductId = confirmedMatch?.productId;

    results.set(index, determineLineStatus(item, productsV2, index, confirmedProductId));
  });

  return results;
}

/**
 * Check if all items can be validated (all green or resolved)
 */
export function canValidateAll(statuses: Map<number, LineStatusResult>): boolean {
  for (const [_, status] of statuses) {
    if (status.requiresDecision) {
      return false;
    }
  }
  return true;
}

/**
 * Count items by status
 */
export function countByStatus(statuses: Map<number, LineStatusResult>): {
  validated: number;
  priceAlert: number;
  needsAction: number;
  total: number;
} {
  let validated = 0;
  let needsAction = 0;

  for (const [_, status] of statuses) {
    switch (status.status) {
      case "validated":
        validated++;
        break;
      case "needs_action":
        needsAction++;
        break;
    }
  }

  return {
    validated,
    priceAlert: 0,
    needsAction,
    total: validated + needsAction,
  };
}
