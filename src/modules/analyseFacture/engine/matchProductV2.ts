/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V2 PRODUCT MATCHER ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Matches extracted products against Produits V2 database.
 *
 * PRIORITY:
 * 1. code_produit (exact match) → 100% confidence
 * 2. name_normalized (exact match) → 100% confidence
 * 3. name similarity (70-99%) → fuzzy match
 *
 * RULE: This engine runs in MEMORY only (no DB writes)
 */

import type { ProductV2 } from "@/modules/produitsV2";
import { normalizeProductNameV2 } from "@/modules/produitsV2";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type MatchType = "code_produit" | "name_exact";
// NOTE: "name_fuzzy" REMOVED — fuzzy matching disabled, THE BRAIN handles suggestions

export interface ProductV2Match {
  /** Matched product from V2 */
  product: ProductV2;
  /** Type of match */
  matchType: MatchType;
  /** Confidence 0-100 */
  confidence: number;
}

export interface MatchResult {
  /** Best match found */
  match: ProductV2Match | null;
  /** Alternative matches for fuzzy (70-99%) cases */
  alternatives: ProductV2Match[];
  /** Is this an exact match (100%)? */
  isExact: boolean;
  /** Is this a new product (no match found)? */
  isNew: boolean;
}
// ═══════════════════════════════════════════════════════════════════════════
// CODE NORMALIZATION — strip supplier prefixes for matching
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a product code for matching:
 * - trim + lowercase
 * - strip leading numeric prefix followed by space (e.g. "04 0171-5" → "0171-5")
 */
function normalizeCode(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  // Strip leading digits + space prefix (e.g. "04 0171-5" → "0171-5")
  return trimmed.replace(/^\d+\s+/, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN MATCHER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Match an extracted product against V2 products database
 *
 * @param codeProduit - Extracted product code (may be null)
 * @param nomProduit - Extracted product name
 * @param productsV2 - List of existing V2 products
 * @returns Match result with best match and alternatives
 */
export function matchProductV2(
  codeProduit: string | null,
  nomProduit: string,
  productsV2: ProductV2[]
): MatchResult {
  const noMatch: MatchResult = {
    match: null,
    alternatives: [],
    isExact: false,
    isNew: true,
  };

  if (productsV2.length === 0) {
    return noMatch;
  }

  const hasCodeProduit = codeProduit && codeProduit.trim().length > 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 1: Match by code_produit (exact) — STRICT MODE
  // ═══════════════════════════════════════════════════════════════════════════
  // RULE: If code_produit is present, we ONLY match by code.
  // If not found → return "new product" (no fallback to name matching!)
  // ═══════════════════════════════════════════════════════════════════════════

  if (hasCodeProduit) {
    const normalizedCode = normalizeCode(codeProduit!);
    const codeMatch = productsV2.find(
      (p) => p.code_produit ? normalizeCode(p.code_produit) === normalizedCode : false
    );

    if (codeMatch) {
      // DEV LOG: Code match found
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[matchProductV2] ✅ CODE MATCH", {
          extractedCode: codeProduit,
          matchedProductId: codeMatch.id,
          matchedProductCode: codeMatch.code_produit,
          matchedProductName: codeMatch.nom_produit,
        });
      }

      return {
        match: {
          product: codeMatch,
          matchType: "code_produit",
          confidence: 100,
        },
        alternatives: [],
        isExact: true,
        isNew: false,
      };
    }

    // Code present but NOT found in V2 → STOP HERE
    // Do NOT fallback to name matching (this was Bug 1!)
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[matchProductV2] ⚠️ CODE NOT FOUND — no fallback", {
        extractedCode: codeProduit,
        extractedName: nomProduit,
        availableCodesCount: productsV2.filter((p) => p.code_produit).length,
      });
    }

    return {
      match: null,
      alternatives: [],
      isExact: false,
      isNew: true,
      // This signals: "code_produit was provided but unknown"
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY 2: Match by name_normalized (exact) — ONLY if NO code_produit
  // ═══════════════════════════════════════════════════════════════════════════

  const normalizedName = normalizeProductNameV2(nomProduit);

  const nameExactMatch = productsV2.find(
    (p) => p.name_normalized.toLowerCase() === normalizedName.toLowerCase()
  );

  if (nameExactMatch) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[matchProductV2] ✅ NAME EXACT MATCH", {
        extractedName: nomProduit,
        normalizedName,
        matchedProductId: nameExactMatch.id,
      });
    }

    return {
      match: {
        product: nameExactMatch,
        matchType: "name_exact",
        confidence: 100,
      },
      alternatives: [],
      isExact: true,
      isNew: false,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NO EXACT MATCH → NEW PRODUCT
  // Fuzzy matching DISABLED (THE BRAIN handles suggestions via human action)
  // ═══════════════════════════════════════════════════════════════════════════

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[matchProductV2] ⚠️ NO EXACT MATCH — marked as new", {
      extractedName: nomProduit,
      normalizedName,
      availableProductsCount: productsV2.length,
    });
  }

  // No match found
  return noMatch;
}

/**
 * Batch match multiple extracted products
 */
export function matchProductsV2Batch(
  items: Array<{ codeProduit: string | null; nomProduit: string }>,
  productsV2: ProductV2[]
): Map<number, MatchResult> {
  const results = new Map<number, MatchResult>();

  items.forEach((item, index) => {
    results.set(index, matchProductV2(item.codeProduit, item.nomProduit, productsV2));
  });

  return results;
}
