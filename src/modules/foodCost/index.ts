/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Public API (Barrel Export)
 * ═══════════════════════════════════════════════════════════════
 *
 * Single entry point. Fully isolated and removable.
 * Read-only module — no data written to DB.
 */

// Types
export type {
  CostStatus,
  LineCostResult,
  RecipeCostResult,
  FoodCostProduct,
} from "./types";

// Engine (pure functions)
export { computeLineCost, computeRecipeCost } from "./engine/foodCostEngine";

// Hooks
export { useFoodCostData } from "./hooks/useFoodCostData";
