/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILD PURCHASE CONFIG — Pure function for external supplier context
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Generates `product_input_config.purchase_*` from the product's physical
 * structure. ALWAYS returns L0 / integer (or continuous fallback).
 *
 * RULES:
 *   - If packaging exists → integer on L0 (first valid type_unit_id)
 *   - If no packaging → fallback to final_unit_id (continuous if weight/volume)
 *   - NEVER multi_level — external suppliers deliver in whole units
 *   - INDEPENDENT of allow_unit_sale toggle (that's B2B sale only)
 *
 * DOES NOT:
 *   - Touch the resolver or any modal
 *   - Perform BFS conversion
 *   - Read or write reception_* or internal_* columns
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { InputMode } from "@/modules/inputConfig";

export interface PurchaseConfigResult {
  purchase_mode: InputMode;
  purchase_preferred_unit_id: string | null;
  purchase_unit_chain: null;
}

export interface PackagingLevelInput {
  type_unit_id?: string | null;
}

function isUnitContinuous(
  unitId: string | null,
  dbUnits: Array<{ id: string; family: string | null }>,
): boolean {
  if (!unitId) return false;
  const unit = dbUnits.find((u) => u.id === unitId);
  return unit?.family === "weight" || unit?.family === "volume";
}

/**
 * Build the purchase config — always L0, always simple.
 */
export function buildPurchaseConfig(
  packagingLevels: PackagingLevelInput[],
  finalUnitId: string | null,
  dbUnits: Array<{ id: string; family: string | null }>,
): PurchaseConfigResult {
  const validLevels = packagingLevels.filter(
    (l): l is PackagingLevelInput & { type_unit_id: string } =>
      !!l.type_unit_id,
  );

  // No packaging → fallback to final_unit_id
  if (validLevels.length === 0) {
    const mode: InputMode = isUnitContinuous(finalUnitId, dbUnits)
      ? "continuous"
      : "integer";
    return {
      purchase_mode: mode,
      purchase_preferred_unit_id: finalUnitId,
      purchase_unit_chain: null,
    };
  }

  // Has packaging → always L0, integer
  return {
    purchase_mode: "integer",
    purchase_preferred_unit_id: validLevels[0].type_unit_id,
    purchase_unit_chain: null,
  };
}
