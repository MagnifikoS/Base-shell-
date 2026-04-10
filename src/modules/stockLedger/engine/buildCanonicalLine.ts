/**
 * ═══════════════════════════════════════════════════════════════════════════
 * buildCanonicalLine — SINGLE SOURCE for canonical line metadata
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Used by: Reception, Withdrawal, BL Correction, AddProductDialog
 *
 * GUARANTEES:
 * - canonical_family is ALWAYS looked up from measurement_units (never hardcoded)
 * - context_hash is ALWAYS computed deterministically (never hardcoded)
 * - Throws if unit not found or family missing
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { computeContextHash, buildContextHashInput } from "./contextHash";
import type { Json } from "@/integrations/supabase/types";

// ═══ Input types ═══

export interface ProductConfig {
  supplier_billing_unit_id: string | null;
  conditionnement_config: Json | null;
}

export interface UnitInfo {
  id: string;
  family: string | null;
  abbreviation: string;
  name: string;
}

export interface BuildCanonicalLineInput {
  canonicalUnitId: string;
  product: ProductConfig;
  /** All measurement_units from DB (or at minimum the relevant one) */
  units: UnitInfo[];
}

// ═══ Output type ═══

export interface CanonicalLineMetadata {
  canonical_unit_id: string;
  canonical_family: string;
  canonical_label: string;
  context_hash: string;
}

// ═══ Main function ═══

/**
 * Build canonical metadata for a stock line (document line or event).
 * Throws if the unit doesn't exist or has no family.
 */
export function buildCanonicalLine(input: BuildCanonicalLineInput): CanonicalLineMetadata {
  const { canonicalUnitId, product, units } = input;

  // 1. Lookup unit info — NEVER assume family
  const unitInfo = units.find((u) => u.id === canonicalUnitId);
  if (!unitInfo) {
    throw new Error(
      `UNIT_NOT_FOUND: L'unité "${canonicalUnitId}" n'existe pas dans measurement_units.`
    );
  }
  if (!unitInfo.family) {
    throw new Error(
      `UNIT_NO_FAMILY: L'unité "${unitInfo.name}" (${canonicalUnitId}) n'a pas de famille définie.`
    );
  }

  // 2. Compute context hash deterministically
  const packagingLevels = extractPackagingLevels(product.conditionnement_config);
  const equivalence = extractEquivalence(product.conditionnement_config);
  const hashInput = buildContextHashInput({
    canonical_unit_id: canonicalUnitId,
    billing_unit_id: product.supplier_billing_unit_id,
    packaging_levels: packagingLevels,
    equivalence,
  });
  const contextHash = computeContextHash(hashInput);

  return {
    canonical_unit_id: canonicalUnitId,
    canonical_family: unitInfo.family,
    canonical_label: unitInfo.name ?? unitInfo.abbreviation,
    context_hash: contextHash,
  };
}

// ═══ Helpers (moved from individual components) ═══

export function extractPackagingLevels(config: Json | null): Array<{
  type_unit_id: string | null;
  contains_unit_id: string | null;
  quantity: number;
}> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  // Support both "levels" (normalized) and "packagingLevels" (wizard format)
  const levels = config.levels ?? config.packagingLevels;
  if (!levels || !Array.isArray(levels)) return [];
  return levels.map((l) => {
    const item = typeof l === "object" && l !== null && !Array.isArray(l) ? l : {};
    // Support both "quantity" (normalized) and "containsQuantity" (wizard format)
    const qty = typeof item.quantity === "number" ? item.quantity
      : typeof item.containsQuantity === "number" ? item.containsQuantity
      : 1;
    return {
      type_unit_id: typeof item.type_unit_id === "string" ? item.type_unit_id : null,
      contains_unit_id: typeof item.contains_unit_id === "string" ? item.contains_unit_id : null,
      quantity: qty,
    };
  });
}

export function extractEquivalence(config: Json | null): {
  source_unit_id: string | null;
  unit_id: string | null;
  quantity: number | null;
} | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const eq = config.equivalence;
  if (!eq || typeof eq !== "object" || Array.isArray(eq)) return null;
  return {
    source_unit_id: typeof eq.source_unit_id === "string" ? eq.source_unit_id : null,
    unit_id: typeof eq.unit_id === "string" ? eq.unit_id : null,
    quantity: typeof eq.quantity === "number" ? eq.quantity : null,
  };
}
