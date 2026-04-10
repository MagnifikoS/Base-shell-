/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Types
 * ═══════════════════════════════════════════════════════════════
 */

import type { SellingPriceMode } from "@/modules/recettes/types";

/** Status of cost calculation for a recipe */
export type CostStatus = "complet" | "partiel" | "impossible" | "vide";

/** Result of computing cost for a single recipe line */
export interface LineCostResult {
  lineId: string;
  productId: string;
  cost: number | null;
  warning: string | null;
}

/** Result of computing cost for a full recipe */
export interface RecipeCostResult {
  recipeId: string;
  totalCost: number;
  linesOk: number;
  linesTotal: number;
  status: CostStatus;
  lineResults: LineCostResult[];
  /** Number of portions (from recipe); null = not portionable */
  portions: number | null;
  /** totalCost / portions; null if not portionable or not calculable */
  costPerPortion: number | null;
  /** Selling price from recipe; null if not set */
  sellingPrice: number | null;
  /** How to interpret selling price */
  sellingPriceMode: SellingPriceMode;
  /** Ratio (multiplication factor); null if not calculable or status !== complet */
  ratio: number | null;
}

/** Minimal product data needed for food cost calculation */
export interface FoodCostProduct {
  id: string;
  nom_produit: string;
  final_unit_price: number | null;
  final_unit_id: string | null;
  conditionnement_config: {
    packagingLevels?: { id: string; type: string; type_unit_id?: string | null; containsQuantity: number | null; containsUnit: string; contains_unit_id?: string | null }[];
    equivalence?: { source: string; source_unit_id?: string | null; quantity: number; unit: string; unit_id?: string | null } | null;
  } | null;
}
