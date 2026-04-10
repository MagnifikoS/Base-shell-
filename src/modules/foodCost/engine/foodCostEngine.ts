/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Engine (PURE — no React, no Supabase)
 * ═══════════════════════════════════════════════════════════════
 *
 * V1.1: supports sub-recipe lines (preparations)
 */

import { findConversionPath } from "@/modules/conditionnementV2";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { SellingPriceMode } from "@/modules/recettes/types";
import type {
  LineCostResult,
  RecipeCostResult,
  CostStatus,
  FoodCostProduct,
} from "../types";

export interface RecipeLineInput {
  id: string;
  product_id: string | null;
  sub_recipe_id?: string | null;
  quantity: number;
  unit_id: string;
}

interface RecipeInput {
  id: string;
  recipe_lines: RecipeLineInput[];
  portions: number | null;
  selling_price: number | null;
  selling_price_mode: SellingPriceMode;
}

/**
 * Data needed to cost a sub-recipe line.
 * Computed externally and passed into the engine.
 */
export interface SubRecipeCostData {
  /** Total cost of the preparation */
  totalCost: number;
  /** Yield quantity (e.g. 3000 for 3000g) */
  yieldQuantity: number;
  /** Yield unit ID */
  yieldUnitId: string;
  /** Status of the preparation cost calculation */
  status: CostStatus;
}

/**
 * Compute cost for a single recipe line.
 */
export function computeLineCost(
  line: RecipeLineInput,
  product: FoodCostProduct | undefined,
  units: UnitWithFamily[],
  dbConversions: ConversionRule[],
  subRecipeCosts?: Map<string, SubRecipeCostData>
): LineCostResult {
  const base = { lineId: line.id, productId: line.product_id ?? line.sub_recipe_id ?? "" };

  // ── Sub-recipe line ──
  if (line.sub_recipe_id) {
    const prepData = subRecipeCosts?.get(line.sub_recipe_id);
    if (!prepData) {
      return { ...base, cost: null, warning: "Préparation introuvable" };
    }
    if (prepData.status === "impossible" || prepData.status === "vide") {
      return { ...base, cost: null, warning: "Coût de la préparation non calculable" };
    }
    if (prepData.yieldQuantity <= 0) {
      return { ...base, cost: null, warning: "Rendement non défini" };
    }

    const unitCost = prepData.totalCost / prepData.yieldQuantity;

    // If units match, simple multiply
    if (line.unit_id === prepData.yieldUnitId) {
      return { ...base, cost: line.quantity * unitCost, warning: null };
    }

    // Try conversion
    const result = findConversionPath(
      line.unit_id,
      prepData.yieldUnitId,
      units,
      dbConversions,
      [],
      null
    );

    if (!result.reached || result.factor == null) {
      return { ...base, cost: null, warning: "Conversion d'unité impossible vers la préparation" };
    }

    return { ...base, cost: line.quantity * result.factor * unitCost, warning: null };
  }

  // ── Product line (existing logic) ──
  if (!product) {
    return { ...base, cost: null, warning: "Produit introuvable" };
  }
  if (product.final_unit_price == null) {
    return { ...base, cost: null, warning: "Prix manquant" };
  }
  if (!product.final_unit_id) {
    return { ...base, cost: null, warning: "Unité prix manquante" };
  }

  if (line.unit_id === product.final_unit_id) {
    return {
      ...base,
      cost: line.quantity * product.final_unit_price,
      warning: null,
    };
  }

  const config = product.conditionnement_config;
  const packagingLevels: PackagingLevel[] =
    (config?.packagingLevels as PackagingLevel[]) ?? [];
  const equivalence: Equivalence | null =
    (config?.equivalence as Equivalence | null) ?? null;

  const result = findConversionPath(
    line.unit_id,
    product.final_unit_id,
    units,
    dbConversions,
    packagingLevels,
    equivalence
  );

  if (!result.reached || result.factor == null) {
    return {
      ...base,
      cost: null,
      warning: result.warnings[0] ?? "Conversion impossible",
    };
  }

  return {
    ...base,
    cost: line.quantity * result.factor * product.final_unit_price,
    warning: null,
  };
}

/**
 * Compute total cost for a recipe (sum of all calculable lines).
 * Ratio computed based on selling_price_mode:
 * - per_recipe:  sellingPrice / totalCost
 * - per_portion: sellingPrice / costPerPortion
 */
export function computeRecipeCost(
  recipe: RecipeInput,
  productsMap: Map<string, FoodCostProduct>,
  units: UnitWithFamily[],
  dbConversions: ConversionRule[],
  subRecipeCosts?: Map<string, SubRecipeCostData>
): RecipeCostResult {
  const lines = recipe.recipe_lines;
  const portions = recipe.portions;
  const sellingPrice = recipe.selling_price;
  const mode = recipe.selling_price_mode ?? "per_recipe";

  if (lines.length === 0) {
    return {
      recipeId: recipe.id,
      totalCost: 0,
      linesOk: 0,
      linesTotal: 0,
      status: "vide",
      lineResults: [],
      portions,
      costPerPortion: null,
      sellingPrice,
      sellingPriceMode: mode,
      ratio: null,
    };
  }

  const lineResults = lines.map((line) =>
    computeLineCost(
      line,
      line.product_id ? productsMap.get(line.product_id) : undefined,
      units,
      dbConversions,
      subRecipeCosts
    )
  );

  const linesOk = lineResults.filter((r) => r.cost != null).length;
  const linesTotal = lines.length;
  const totalCost = lineResults.reduce((sum, r) => sum + (r.cost ?? 0), 0);

  let status: CostStatus;
  if (linesOk === linesTotal) status = "complet";
  else if (linesOk > 0) status = "partiel";
  else status = "impossible";

  const costPerPortion =
    portions != null && portions >= 1 && (status === "complet" || status === "partiel")
      ? totalCost / portions
      : null;

  // Ratio only when cost is complete and selling price > 0
  let ratio: number | null = null;
  if (status === "complet" && sellingPrice != null && sellingPrice > 0 && totalCost > 0) {
    if (mode === "per_portion" && costPerPortion != null && costPerPortion > 0) {
      // price is per portion → compare to cost per portion
      ratio = sellingPrice / costPerPortion;
    } else if (mode === "per_recipe") {
      // price is for the whole recipe → compare to total cost
      ratio = sellingPrice / totalCost;
    }
  }

  return {
    recipeId: recipe.id,
    totalCost,
    linesOk,
    linesTotal,
    status,
    lineResults,
    portions,
    costPerPortion,
    sellingPrice,
    sellingPriceMode: mode,
    ratio,
  };
}
