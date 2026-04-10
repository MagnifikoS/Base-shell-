/**
 * Product Filtering Engine
 *
 * Filters extracted products against existing SSOT products.
 * Priority: code_produit > name_normalized
 */

import type { ExtractedProductLine } from "@/modules/shared";
import { ExistingProduct } from "../types";
import { normalizeProductNameV2 as normalizeProductName } from "@/modules/produitsV2";

interface FilterResult {
  /** Products that are NEW (not in SSOT) */
  filteredItems: ExtractedProductLine[];
  /** Products that already exist in SSOT */
  existingItems: ExtractedProductLine[];
  /** Count of filtered out items */
  filteredOutCount: number;
}

/**
 * Filter extracted products to only keep new ones
 *
 * Matching logic:
 * 1. If code_produit exists: exact match on code_produit (case-insensitive)
 * 2. Else: match on normalized name
 */
export function filterExistingProducts(
  items: ExtractedProductLine[],
  existingProducts: ExistingProduct[]
): FilterResult {
  // Normalize code: trim, lowercase, strip leading numeric prefix + space
  const normalizeCode = (code: string): string =>
    code.trim().toLowerCase().replace(/^\d+\s+/, "");

  // Build lookup maps for fast matching
  const codeMap = new Map<string, ExistingProduct>();
  const nameMap = new Map<string, ExistingProduct>();

  for (const product of existingProducts) {
    // Map by code_produit (normalized)
    if (product.code_produit) {
      codeMap.set(normalizeCode(product.code_produit), product);
    }

    // Map by name_normalized
    if (product.name_normalized) {
      nameMap.set(product.name_normalized.toLowerCase(), product);
    }
  }

  const filteredItems: ExtractedProductLine[] = [];
  const existingItems: ExtractedProductLine[] = [];

  for (const item of items) {
    let isExisting = false;

    // Priority 1: Match by code_produit
    if (item.code_produit) {
      if (codeMap.has(normalizeCode(item.code_produit))) {
        isExisting = true;
      }
    }

    // Priority 2: Match by normalized name (if no code match)
    if (!isExisting) {
      const normalizedName = normalizeProductName(item.nom_produit_complet);
      if (nameMap.has(normalizedName)) {
        isExisting = true;
      }
    }

    if (isExisting) {
      existingItems.push(item);
    } else {
      filteredItems.push(item);
    }
  }

  return {
    filteredItems,
    existingItems,
    filteredOutCount: existingItems.length,
  };
}
