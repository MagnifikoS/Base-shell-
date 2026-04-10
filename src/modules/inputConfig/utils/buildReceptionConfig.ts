/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILD RECEPTION CONFIG — Shared pure function
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for auto-generating `product_input_config.reception_*`
 * from the product's physical structure (conditionnement_config + allow_unit_sale).
 *
 * USED BY:
 *   - Wizard Step 4 (product creation/edit)
 *   - B2B Import pipeline (future — étape 2)
 *
 * RULES (from validated strategy):
 *   - Cas A: packaging + toggle OFF → integer, L0 only
 *   - Cas B: packaging + toggle ON + ≥2 levels → multi_level, [L0, L1] max
 *   - Cas C: packaging + toggle ON + 1 level → integer, L0 only
 *   - Cas D: no packaging → fallback to final_unit_id
 *   - Limitation to 2 levels is applied HERE, never in the resolver or modal
 *
 * DOES NOT:
 *   - Touch the resolver (resolveInputUnitForContext)
 *   - Touch any modal or runtime logic
 *   - Perform BFS conversion
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { InputMode } from "@/modules/inputConfig";

export interface ReceptionConfigResult {
  reception_mode: InputMode;
  reception_preferred_unit_id: string | null;
  reception_unit_chain: string[] | null;
}

export interface PackagingLevelInput {
  type_unit_id?: string | null;
}

/**
 * Determine the unit family from dbUnits.
 * Returns "continuous" for weight/volume, "discrete" otherwise.
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
 * Build the reception config from the product's physical structure.
 *
 * @param packagingLevels - The product's packaging levels (from conditionnement_config)
 * @param allowUnitSale - The toggle value (allow_unit_sale on products_v2)
 * @param finalUnitId - The product's final unit ID (fallback when no packaging)
 * @param dbUnits - Reference units for family classification (continuous vs discrete)
 */
export function buildReceptionConfig(
  packagingLevels: PackagingLevelInput[],
  allowUnitSale: boolean,
  finalUnitId: string | null,
  dbUnits: Array<{ id: string; family: string | null }>,
): ReceptionConfigResult {
  // Filter to levels with a valid type_unit_id
  const validLevels = packagingLevels.filter(
    (l): l is PackagingLevelInput & { type_unit_id: string } =>
      !!l.type_unit_id,
  );

  // ── Cas D: No packaging → fallback to final_unit_id ──
  if (validLevels.length === 0) {
    const mode: InputMode = isUnitContinuous(finalUnitId, dbUnits)
      ? "continuous"
      : "integer";
    return {
      reception_mode: mode,
      reception_preferred_unit_id: finalUnitId,
      reception_unit_chain: null,
    };
  }

  const l0UnitId = validLevels[0].type_unit_id;

  if (!allowUnitSale) {
    // ── Cas A: toggle OFF → integer, L0 only ──
    return {
      reception_mode: "integer",
      reception_preferred_unit_id: l0UnitId,
      reception_unit_chain: null,
    };
  }

  // Toggle ON
  if (validLevels.length >= 2) {
    // ── Cas B: toggle ON + ≥2 levels → multi_level, [L0, L1] max ──
    const l1UnitId = validLevels[1].type_unit_id;
    return {
      reception_mode: "multi_level",
      reception_preferred_unit_id: null,
      reception_unit_chain: [l0UnitId, l1UnitId],
    };
  }

  // ── Cas C: toggle ON + 1 level → integer, L0 only ──
  return {
    reception_mode: "integer",
    reception_preferred_unit_id: l0UnitId,
    reception_unit_chain: null,
  };
}
