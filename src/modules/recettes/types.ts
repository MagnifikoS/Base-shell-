/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Types
 * ═══════════════════════════════════════════════════════════════
 */

/** Whether selling price is for the whole recipe or per portion */
export type SellingPriceMode = "per_recipe" | "per_portion";

export interface RecipeType {
  id: string;
  establishment_id: string;
  name: string;
  icon: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface Recipe {
  id: string;
  establishment_id: string;
  recipe_type_id: string;
  name: string;
  portions: number | null;
  selling_price: number | null;
  selling_price_mode: SellingPriceMode;
  /** V1 preparations */
  is_preparation: boolean;
  yield_quantity: number | null;
  yield_unit_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeLine {
  id: string;
  recipe_id: string;
  /** Product ID — null when line is a sub-recipe */
  product_id: string | null;
  /** Sub-recipe ID — null when line is a product */
  sub_recipe_id: string | null;
  quantity: number;
  unit_id: string;
  display_order: number;
  created_at: string;
}

/** Recipe with its lines joined (used in detail view) */
export interface RecipeWithLines extends Recipe {
  recipe_lines: RecipeLine[];
}
