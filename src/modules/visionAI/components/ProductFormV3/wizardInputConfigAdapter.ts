/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WIZARD → INPUT CONFIG ADAPTER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Maps wizard state to the shape expected by `buildUnitChoicesFromEngine`.
 * NO new logic — just a data shape transformation.
 *
 * Uses EXACTLY the same engine functions as SingleConfigDialog:
 * - resolveProductUnitContext (BFS)
 * - buildUnitChoicesFromEngine
 * - isMultiLevelPossible
 * - getChainableUnits
 */

import type { WizardState } from "./types";
import type { ProductForConfig, ProductNature, UnitNature } from "@/modules/inputConfig";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { ConditioningConfig } from "@/modules/produitsV2";
import type { Equivalence } from "@/modules/conditionnementV2";

/**
 * Builds a ProductForConfig-compatible object from wizard state.
 * This is the ONLY adapter needed — everything else is reused as-is.
 */
export function wizardStateToProductForConfig(
  state: WizardState,
  effectiveStockHandlingUnitId: string | null,
  effectiveDeliveryUnitId: string | null,
  equivalenceObject: Equivalence | null,
  conditioningConfig: ConditioningConfig | null,
  dbUnits: UnitWithFamily[],
): ProductForConfig {
  // Resolve final unit name
  const finalUnitObj = state.finalUnitId
    ? dbUnits.find((u) => u.id === state.finalUnitId)
    : null;
  const finalUnitName = finalUnitObj?.name ?? state.finalUnit ?? null;

  // Classify unit family
  const unitFamily: UnitNature =
    finalUnitObj?.family === "weight" || finalUnitObj?.family === "volume"
      ? "continuous"
      : "discrete";

  // Classify product nature
  let productNature: ProductNature = "discrete_pure";
  if (unitFamily === "continuous") {
    productNature = "continuous_pure";
  } else if (equivalenceObject) {
    const equivUnit = equivalenceObject.unit_id
      ? dbUnits.find((u) => u.id === equivalenceObject.unit_id)
      : null;
    if (equivUnit?.family === "weight" || equivUnit?.family === "volume") {
      productNature = "hybrid_discrete_continuous";
    }
  }

  // Build packaging levels in the expected format
  const packagingLevels = state.packagingLevels.map((lvl) => ({
    id: lvl.id,
    type: lvl.type,
    type_unit_id: lvl.type_unit_id ?? null,
    containsQuantity: lvl.containsQuantity,
    containsUnit: lvl.containsUnit ?? "",
    contains_unit_id: lvl.contains_unit_id ?? null,
  }));

  // Build equivalence display
  let equivalenceDisplay: string | null = null;
  let equivalenceLabel: string | null = null;
  let equivalenceTargetFamily: UnitNature | null = null;
  if (equivalenceObject) {
    equivalenceDisplay = `1 ${equivalenceObject.source} ≈ ${equivalenceObject.quantity} ${equivalenceObject.unit}`;
    equivalenceLabel = equivalenceObject.unit;
    const equivUnit = equivalenceObject.unit_id
      ? dbUnits.find((u) => u.id === equivalenceObject.unit_id)
      : null;
    equivalenceTargetFamily =
      equivUnit?.family === "weight" || equivUnit?.family === "volume"
        ? "continuous"
        : "discrete";
  }

  return {
    id: "__wizard_preview__",
    nom_produit: state.productName,
    final_unit: finalUnitName,
    final_unit_id: state.finalUnitId,
    unit_family: unitFamily,
    product_nature: productNature,
    packaging_levels_count: packagingLevels.length,
    packaging_levels: packagingLevels,
    has_equivalence: !!equivalenceObject,
    equivalence_target_family: equivalenceTargetFamily,
    equivalence_label: equivalenceLabel,
    equivalence_display: equivalenceDisplay,
    has_supplier_context: false,
    config: null, // Will be set separately when loading existing config
    status: "not_configured",
    reception_status: "not_configured",
    internal_status: "not_configured",
    stock_handling_unit_id: effectiveStockHandlingUnitId,
    supplier_billing_unit_id: state.billedUnitId,
    delivery_unit_id: effectiveDeliveryUnitId,
    conditionnement_config_raw: conditioningConfig as unknown as Record<string, unknown> | null,
    autoConfigPayload: null,
  };
}
