/**
 * B2B Category Mapper — Phase C
 * Pure function: maps supplier category to local client category by normalized name
 */

import type { CategoryMappingResult, LocalCategory } from "./b2bTypes";

/** Normalize category name for comparison */
export function normalizeCategoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map a supplier category to a local client category.
 */
export function mapCategory(
  sourceCategoryId: string | null,
  sourceCategoryName: string | null,
  localCategories: LocalCategory[]
): CategoryMappingResult {
  // Resolve effective name: prefer joined category name, fallback to legacy text
  const effectiveName = sourceCategoryName || null;

  // No category at all = OK (displayed as "Sans catégorie")
  if (!sourceCategoryId && !effectiveName) {
    return {
      sourceCategoryId: null,
      sourceCategoryName: null,
      status: "NULL_OK",
      localCategoryId: null,
      localCategoryName: null,
    };
  }

  const normalizedSource = normalizeCategoryName(effectiveName!);
  const activeCategories = localCategories.filter((c) => !c.is_archived);

  // Match by normalized name
  const matches = activeCategories.filter((c) => {
    const localNorm = c.name_normalized
      ? normalizeCategoryName(c.name_normalized)
      : normalizeCategoryName(c.name);
    return localNorm === normalizedSource;
  });

  if (matches.length === 1) {
    return {
      sourceCategoryId,
      sourceCategoryName,
      status: "MAPPED",
      localCategoryId: matches[0].id,
      localCategoryName: matches[0].name,
    };
  }

  // 0 match = NOT_FOUND (UNIQUE constraint makes >1 impossible for active categories)
  return {
    sourceCategoryId,
    sourceCategoryName,
    status: "NOT_FOUND",
    localCategoryId: null,
    localCategoryName: null,
  };
}
