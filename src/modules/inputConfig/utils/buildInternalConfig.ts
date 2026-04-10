/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILD INTERNAL CONFIG — Shared pure function
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for auto-generating `product_input_config.internal_*`
 * from the product's physical structure (conditionnement_config + allow_unit_sale).
 *
 * USED BY:
 *   - Wizard Step 5 (product creation/edit) — initial defaults
 *   - B2B Import pipeline (Phase G)
 *
 * RULES:
 *   - Toggle ON + ≥2 packaging levels → multi_level, full chain [L0 → Ln]
 *   - Toggle ON + 1 packaging level  → integer, L0 only
 *   - Toggle OFF + packaging         → integer, stock_handling_unit
 *   - No packaging                   → continuous (weight/volume) or integer (discrete)
 *
 * DOES NOT:
 *   - Touch purchase_* or reception_*
 *   - Touch the resolver (resolveInputUnitForContext)
 *   - Perform BFS conversion
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { InputMode } from "@/modules/inputConfig";

export interface InternalConfigResult {
  internal_mode: InputMode;
  internal_preferred_unit_id: string | null;
  internal_unit_chain: string[] | null;
}

export interface PackagingLevelInput {
  type_unit_id?: string | null;
}

/**
 * Check if a unit is continuous (weight/volume).
 */
function isUnitContinuous(
  unitId: string | null,
  dbUnits: Array<{ id: string; family: string | null }>,
): boolean {
  if (!unitId) return false;
  const unit = dbUnits.find((u) => u.id === unitId);
  return unit?.family === "weight" || unit?.family === "volume";
}

/**
 * Build the internal config from the product's physical structure.
 *
 * @param packagingLevels - The product's packaging levels (from conditionnement_config)
 * @param allowUnitSale - The toggle value (allow_unit_sale on products_v2)
 * @param stockHandlingUnitId - The product's stock handling unit (fallback preferred unit)
 * @param finalUnitId - The product's final unit ID (fallback when no packaging & no stock unit)
 * @param dbUnits - Reference units for family classification (continuous vs discrete)
 */
export function buildInternalConfig(
  packagingLevels: PackagingLevelInput[],
  allowUnitSale: boolean,
  stockHandlingUnitId: string | null,
  finalUnitId: string | null,
  dbUnits: Array<{ id: string; family: string | null }>,
): InternalConfigResult {
  // Filter to levels with a valid type_unit_id
  const validLevels = packagingLevels.filter(
    (l): l is PackagingLevelInput & { type_unit_id: string } =>
      !!l.type_unit_id,
  );

  const fallbackUnit = stockHandlingUnitId ?? finalUnitId;

  // ── No packaging → fallback to stock/final unit ──
  if (validLevels.length === 0) {
    const mode: InputMode = isUnitContinuous(fallbackUnit, dbUnits)
      ? "continuous"
      : "integer";
    return {
      internal_mode: mode,
      internal_preferred_unit_id: fallbackUnit,
      internal_unit_chain: null,
    };
  }

  // ── Toggle OFF → integer on stock handling unit ──
  if (!allowUnitSale) {
    return {
      internal_mode: "integer",
      internal_preferred_unit_id: fallbackUnit,
      internal_unit_chain: null,
    };
  }

  // ── Toggle ON + ≥2 levels → multi_level, full chain ──
  if (validLevels.length >= 2) {
    return {
      internal_mode: "multi_level",
      internal_preferred_unit_id: null,
      internal_unit_chain: validLevels.map((l) => l.type_unit_id),
    };
  }

  // ── Toggle ON + 1 level → integer, L0 only ──
  return {
    internal_mode: "integer",
    internal_preferred_unit_id: validLevels[0].type_unit_id,
    internal_unit_chain: null,
  };
}
