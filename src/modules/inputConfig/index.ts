/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE INPUT CONFIG — PUBLIC API
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Isolated DECLARATIVE configuration module for product quantity input rules.
 * 
 * ARCHITECTURE:
 * - This module declares preferences (allowed modes, default units)
 * - It does NOT resolve units or convert quantities
 * - Unit resolution is delegated to src/core/unitConversion/
 * - Validation uses engine-derived choices (computeConfigStatusFromChoices)
 */

export type {
  InputMode,
  ConfigStatus,
  UnitNature,
  ProductNature,
  ProductInputConfigRow,
  ProductForConfig,
  BulkConfigPayload,
  InputConfigFilters,
} from "./types";

export { MODE_LABELS, NATURE_LABELS } from "./types";

export { buildUnitChoicesFromEngine, findChoiceForConfig, isMultiLevelPossible, getChainableUnits } from "./utils/buildUnitChoices";
export type { UnitChoice } from "./utils/buildUnitChoices";

export { useProductsForConfig, filterProducts } from "./hooks/useProductsForConfig";
export { useSaveInputConfig } from "./hooks/useSaveInputConfig";
export { useProductInputConfigs } from "./hooks/useProductInputConfigs";

export { resolveInputUnitForContext } from "./utils/resolveInputUnitForContext";
export type { InputContext, ProductForResolution, InputResolutionResult, ResolvedInputUnit } from "./utils/resolveInputUnitForContext";

export {
  resolveUnitNature,
  classifyProductNature,
  getAllowedModes,
  getDefaultModes,
  computeConfigStatusFromChoices,
  getCommonAllowedModes,
} from "./utils/configLogic";

export { buildReceptionConfig } from "./utils/buildReceptionConfig";
export type { ReceptionConfigResult, PackagingLevelInput } from "./utils/buildReceptionConfig";

export { buildPurchaseConfig } from "./utils/buildPurchaseConfig";
export type { PurchaseConfigResult } from "./utils/buildPurchaseConfig";

export { buildInternalConfig } from "./utils/buildInternalConfig";
export type { InternalConfigResult } from "./utils/buildInternalConfig";
