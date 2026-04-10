/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Public API (Barrel Export)
 * ═══════════════════════════════════════════════════════════════
 */

// Types
export type {
  RecipeType,
  Recipe,
  RecipeLine,
  RecipeWithLines,
  SellingPriceMode,
} from "./types";

// Hooks
export { useRecipeTypes } from "./hooks/useRecipeTypes";
export { useRecipes } from "./hooks/useRecipes";
export { useProductUnitsForRecipe } from "./hooks/useProductUnitsForRecipe";
export type { ExposedUnit } from "./hooks/useProductUnitsForRecipe";
export { usePreparations } from "./hooks/usePreparations";
export { usePreparationCost } from "./hooks/usePreparationCost";

export { useRecipeB2BListing } from "./hooks/useRecipeB2BListing";
export type { RecipeB2BListing } from "./hooks/useRecipeB2BListing";

// Utils
export { getRecipeTypeIcon, RECIPE_ICON_OPTIONS } from "./utils/recipeIcons";
