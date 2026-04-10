/**
 * Supplier Matching Logic V2
 *
 * Implements three-tier matching with top-3 suggestions:
 * 1. EXACT MATCH (100%) - Strict normalization, auto-select, field locked
 * 2. NEAR MATCH (70-99%) - Loose normalization + Levenshtein, suggest top 3
 * 3. NO MATCH (<70%) - Free field, create new
 */

import { normalizeStrictForExactMatch, normalizeLooseForFuzzyMatch } from "./normalizeSupplierName";

export type MatchType = "exact" | "near" | "none";

export interface SupplierSuggestion {
  id: string;
  name: string;
  similarity: number;
}

export interface SupplierMatchResult {
  type: MatchType;
  supplierId: string | null;
  supplierName: string | null;
  similarity: number;
  message: string;
  /** Top 3 suggestions for near matches (sorted by similarity desc) */
  suggestions: SupplierSuggestion[];
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio (0-1) using Levenshtein
 */
function similarityRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Find best matches for an extracted supplier name
 * Returns top 3 suggestions for near matches
 *
 * MATCHING LOGIC:
 * - EXACT (100%): strict(extracted) === supplier.name_normalized
 * - FUZZY (70-99%): loose(extracted) vs loose(supplier.name) with Levenshtein
 */
export function computeSupplierMatch(
  extractedName: string,
  existingSuppliers: Array<{ id: string; name: string; name_normalized: string | null }>
): SupplierMatchResult {
  if (!extractedName || extractedName.trim() === "") {
    return {
      type: "none",
      supplierId: null,
      supplierName: null,
      similarity: 0,
      message: "Aucun nom de fournisseur fourni",
      suggestions: [],
    };
  }

  if (existingSuppliers.length === 0) {
    return {
      type: "none",
      supplierId: null,
      supplierName: null,
      similarity: 0,
      message: "Nouveau fournisseur à créer",
      suggestions: [],
    };
  }

  // Normalize extracted name - STRICT for exact match
  const extractedStrict = normalizeStrictForExactMatch(extractedName);
  // LOOSE for fuzzy matching
  const extractedLoose = normalizeLooseForFuzzyMatch(extractedName);

  // First pass: check for EXACT match (100%)
  // CRITICAL: Both sides must use the SAME normalization function
  for (const supplier of existingSuppliers) {
    // Prioritize name_normalized (stable DB value), fallback to name
    const rawValue = supplier.name_normalized || supplier.name || "";
    // Apply SAME strict normalization to ensure identical comparison
    const supplierStrict = normalizeStrictForExactMatch(rawValue);

    if (extractedStrict && supplierStrict && extractedStrict === supplierStrict) {
      return {
        type: "exact",
        supplierId: supplier.id,
        supplierName: supplier.name,
        similarity: 1,
        message: "Fournisseur existant reconnu",
        suggestions: [],
      };
    }

    // DEV AUDIT: Catch any mismatch bugs
    if (import.meta.env.DEV && extractedStrict === supplierStrict && extractedStrict !== "") {
      // eslint-disable-next-line no-console
      console.debug("[BUG MATCH STRICT] extractedStrict === supplierStrict but not caught:", {
        extractedStrict,
        supplierStrict,
        supplier: supplier.name,
      });
    }
  }

  // Second pass: FUZZY matching with loose normalization
  // Use name_normalized in priority for consistent matching
  const scoredSuppliers = existingSuppliers.map((supplier) => {
    // Prioritize name_normalized (stable DB value), fallback to name
    const rawValue = supplier.name_normalized || supplier.name || "";
    const supplierLoose = normalizeLooseForFuzzyMatch(rawValue);
    const score = similarityRatio(extractedLoose, supplierLoose);

    return {
      id: supplier.id,
      name: supplier.name,
      similarity: score,
    };
  });

  // Sort by similarity descending
  scoredSuppliers.sort((a, b) => b.similarity - a.similarity);

  const bestMatch = scoredSuppliers[0];

  if (!bestMatch) {
    return {
      type: "none",
      supplierId: null,
      supplierName: null,
      similarity: 0,
      message: "Nouveau fournisseur à créer",
      suggestions: [],
    };
  }

  // Near match: 70-99%
  if (bestMatch.similarity >= 0.7) {
    // Get top 3 suggestions with score >= 70%
    const suggestions = scoredSuppliers.filter((s) => s.similarity >= 0.7).slice(0, 3);

    const matchStrength = bestMatch.similarity >= 0.9 ? "fort" : "possible";

    return {
      type: "near",
      supplierId: bestMatch.id,
      supplierName: bestMatch.name,
      similarity: bestMatch.similarity,
      message: `Match ${matchStrength} : ${bestMatch.name} (${Math.round(bestMatch.similarity * 100)}%)`,
      suggestions,
    };
  }

  // No match: <70%
  return {
    type: "none",
    supplierId: null,
    supplierName: null,
    similarity: bestMatch.similarity,
    message: "Aucun fournisseur proche trouvé",
    suggestions: [],
  };
}

/**
 * Re-run matching when user manually edits the name
 * (used for de-validation on manual change)
 */
export function recomputeMatch(
  newName: string,
  existingSuppliers: Array<{ id: string; name: string; name_normalized: string | null }>
): SupplierMatchResult {
  return computeSupplierMatch(newName, existingSuppliers);
}
