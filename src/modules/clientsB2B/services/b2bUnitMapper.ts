/**
 * B2B Unit Mapper — Phase B
 * Pure function: maps supplier unit UUIDs to local client UUIDs
 * Matching by (family, abbreviation) then (family, name) then aliases
 */

import type { B2BSupplierUnit, LocalUnit, UnitMappingResult } from "./b2bTypes";

/** Normalize text for comparison: lowercase, trim, remove accents & punctuation */
export function normalizeUnitText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple plural→singular (French basics) */
function singularize(text: string): string {
  if (text.endsWith("s") && text.length > 2) {
    return text.slice(0, -1);
  }
  return text;
}

/**
 * Map a single supplier unit to a local client unit.
 */
export function mapSingleUnit(
  sourceUnit: B2BSupplierUnit,
  localUnits: LocalUnit[]
): UnitMappingResult {
  const base: Omit<UnitMappingResult, "status" | "localUnitId" | "candidates"> = {
    sourceUnitId: sourceUnit.id,
    sourceUnit: {
      name: sourceUnit.name,
      abbreviation: sourceUnit.abbreviation,
      family: sourceUnit.family,
    },
  };

  const srcAbbr = normalizeUnitText(sourceUnit.abbreviation);
  const srcName = normalizeUnitText(sourceUnit.name);
  const srcNameSingular = singularize(srcName);

  // 1. Match by (family, abbreviation) — strongest signal
  const abbrMatches = localUnits.filter(
    (lu) =>
      lu.family === sourceUnit.family &&
      normalizeUnitText(lu.abbreviation) === srcAbbr
  );
  if (abbrMatches.length === 1) {
    return { ...base, status: "MAPPED", localUnitId: abbrMatches[0].id, candidates: [] };
  }
  if (abbrMatches.length > 1) {
    return { ...base, status: "AMBIGUOUS", localUnitId: null, candidates: abbrMatches.map((u) => u.id) };
  }

  // 2. Match by (family, name normalized)
  const nameMatches = localUnits.filter((lu) => {
    if (lu.family !== sourceUnit.family) return false;
    const localName = normalizeUnitText(lu.name);
    return localName === srcName || singularize(localName) === srcNameSingular;
  });
  if (nameMatches.length === 1) {
    return { ...base, status: "MAPPED", localUnitId: nameMatches[0].id, candidates: [] };
  }
  if (nameMatches.length > 1) {
    return { ...base, status: "AMBIGUOUS", localUnitId: null, candidates: nameMatches.map((u) => u.id) };
  }

  // 3. Match by aliases
  const aliasMatches = localUnits.filter((lu) => {
    if (lu.family !== sourceUnit.family) return false;
    if (!lu.aliases || lu.aliases.length === 0) return false;
    return lu.aliases.some((alias) => {
      const normAlias = normalizeUnitText(alias);
      return normAlias === srcAbbr || normAlias === srcName || singularize(normAlias) === srcNameSingular;
    });
  });
  if (aliasMatches.length === 1) {
    return { ...base, status: "MAPPED", localUnitId: aliasMatches[0].id, candidates: [] };
  }
  if (aliasMatches.length > 1) {
    return { ...base, status: "AMBIGUOUS", localUnitId: null, candidates: aliasMatches.map((u) => u.id) };
  }

  // 4. No match
  return { ...base, status: "UNKNOWN", localUnitId: null, candidates: [] };
}

/**
 * Map all units used by a product. Returns array of mapping results
 * for each unique unit UUID referenced by the product.
 */
export function mapProductUnits(
  product: {
    final_unit_id: string | null;
    supplier_billing_unit_id: string | null;
    delivery_unit_id: string | null;
    stock_handling_unit_id: string | null;
    kitchen_unit_id: string | null;
    price_display_unit_id: string | null;
    min_stock_unit_id: string | null;
    conditionnement_config: Record<string, unknown> | null;
  },
  supplierUnits: B2BSupplierUnit[],
  localUnits: LocalUnit[]
): UnitMappingResult[] {
  // Collect all unique source unit IDs from the product
  const unitIds = new Set<string>();
  const directFields = [
    product.final_unit_id,
    product.supplier_billing_unit_id,
    product.delivery_unit_id,
    product.stock_handling_unit_id,
    product.kitchen_unit_id,
    product.price_display_unit_id,
    product.min_stock_unit_id,
  ];
  for (const uid of directFields) {
    if (uid) unitIds.add(uid);
  }

  // Extract unit IDs from conditionnement_config
  if (product.conditionnement_config) {
    const config = product.conditionnement_config;
    if (typeof config === "object") {
      const c = config as Record<string, unknown>;
      if (typeof c.final_unit_id === "string") unitIds.add(c.final_unit_id);

      const levels = c.packagingLevels;
      if (Array.isArray(levels)) {
        for (const level of levels) {
          if (level && typeof level === "object") {
            const l = level as Record<string, unknown>;
            if (typeof l.type_unit_id === "string") unitIds.add(l.type_unit_id);
            if (typeof l.contains_unit_id === "string") unitIds.add(l.contains_unit_id);
          }
        }
      }

      // Equivalence — canonical field names: source_unit_id / unit_id
      const eq = c.equivalence;
      if (eq && typeof eq === "object") {
        const eqObj = eq as Record<string, unknown>;
        if (typeof eqObj.source_unit_id === "string") unitIds.add(eqObj.source_unit_id);
        if (typeof eqObj.unit_id === "string") unitIds.add(eqObj.unit_id);
      }

      // FIX Phase 4: Extract priceLevel.billed_unit_id (was missing — root cause of cross-tenant contamination)
      const pl = c.priceLevel;
      if (pl && typeof pl === "object") {
        const plObj = pl as Record<string, unknown>;
        if (typeof plObj.billed_unit_id === "string") unitIds.add(plObj.billed_unit_id);
      }
    }
  }

  // Map each unique unit
  const results: UnitMappingResult[] = [];
  for (const uid of unitIds) {
    const sourceUnit = supplierUnits.find((u) => u.id === uid);
    if (!sourceUnit) {
      results.push({
        sourceUnitId: uid,
        sourceUnit: { name: "???", abbreviation: "???", family: null },
        status: "UNKNOWN",
        localUnitId: null,
        candidates: [],
      });
      continue;
    }
    results.push(mapSingleUnit(sourceUnit, localUnits));
  }

  return results;
}

/**
 * Check if all unit mappings are resolved (MAPPED).
 */
export function allUnitsMapped(mappings: UnitMappingResult[]): boolean {
  return mappings.length > 0 && mappings.every((m) => m.status === "MAPPED");
}

/**
 * Get first blocking reason from unit mappings.
 */
export function getUnitBlockReason(mappings: UnitMappingResult[]): { status: "BLOCKED_UNIT_UNKNOWN" | "BLOCKED_UNIT_AMBIGUOUS" | "BLOCKED_UNIT_FAMILY_MISMATCH"; reason: string } | null {
  const unknown = mappings.find((m) => m.status === "UNKNOWN");
  if (unknown) {
    return {
      status: "BLOCKED_UNIT_UNKNOWN",
      reason: `Unité "${unknown.sourceUnit.name}" (${unknown.sourceUnit.abbreviation}) inconnue dans votre établissement`,
    };
  }
  const ambiguous = mappings.find((m) => m.status === "AMBIGUOUS");
  if (ambiguous) {
    return {
      status: "BLOCKED_UNIT_AMBIGUOUS",
      reason: `Unité "${ambiguous.sourceUnit.name}" correspond à ${ambiguous.candidates.length} unités locales`,
    };
  }
  return null;
}
