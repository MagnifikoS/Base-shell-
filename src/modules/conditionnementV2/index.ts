/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE CONDITIONNEMENT V2 — INDEX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Point d'entrée unique du module V2 corrigé.
 * Ce module est isolé et supprimable sans effet de bord.
 */

// Types
export type {
  FinalUnit,
  PackagingLevel,
  InvoiceData,
  PriceLevel,
  Equivalence,
  CalculationInput,
  CalculationResult,
  FactorResult,
} from "./types";

export {
  BASE_UNIT_ABBREVIATIONS,
  PACKAGING_TYPE_SUGGESTIONS,
  BASE_UNIT_SUGGESTIONS,
} from "./types";

// Conversions — deprecated stubs removed (BIZ-CND-006)
// All conversion logic now lives in src/core/unitConversion/

// packagingResolver — internal only, not re-exported (prefer findConversionPath)

// Conversion Graph (UUID-only, preferred)
export { findConversionPath } from "./conversionGraph";
export type { ConversionGraphResult } from "./conversionGraph";

// Engine
export { calculateConditionnement, generateLevelId, formatPrice, formatQuantity } from "./engine";

// Wizard Graph Validator
export {
  validatePackagingLevel,
  validateAllPackaging,
  detectPackagingCycles,
  validatePackagingReachability,
  validateUnitReachability,
  validateFullGraph,
  filterReachableUnits,
} from "./wizardGraphValidator";
export type {
  GraphError,
  GraphValidationResult,
  PackagingValidationResult,
  GlobalValidationInput,
} from "./wizardGraphValidator";
