/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE — UNIT CONVERSION MODULE (100% DB-driven, zero hardcode)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Single source of truth: unit_conversions table
 * If no conversion found → null (no guessing)
 * Independent of any business module (Inventaire, Vision AI, etc.)
 */

export { useUnitConversions } from "./useUnitConversions";
export {
  resolveProductUnitContext,
  resolveWizardUnitContext,
} from "./resolveProductUnitContext";
export type {
  ProductUnitContext,
  ProductUnitInput,
  WizardUnitInput,
  ReachableUnit,
} from "./resolveProductUnitContext";
export type { ConversionRule, UnitWithFamily } from "./types";
