/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Mobile list (recipe + ratio only)
 * ═══════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RecipeCostResult } from "../types";
import { FoodCostMobileDetail } from "./FoodCostMobileDetail";

interface RecipeRow {
  id: string;
  name: string;
  recipe_type_id: string;
  portions: number | null;
  selling_price: number | null;
  selling_price_mode: string;
}

interface FoodCostMobileListProps {
  recipes: RecipeRow[];
  costResults: Map<string, RecipeCostResult>;
  typeMap: Map<string, string>;
}

export function FoodCostMobileList({
  recipes,
  costResults,
  typeMap,
}: FoodCostMobileListProps) {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  const selectedRecipe = selectedRecipeId
    ? recipes.find((r) => r.id === selectedRecipeId) ?? null
    : null;
  const selectedResult = selectedRecipeId
    ? costResults.get(selectedRecipeId)
    : undefined;

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden
                      shadow-[0_1px_3px_0_hsl(var(--foreground)/0.04)]">
        <div className="divide-y divide-border/30">
          {recipes.map((recipe) => {
            const result = costResults.get(recipe.id);
            const ratio = result?.ratio;
            const status = result?.status ?? "vide";
            const isPartial = status === "partiel";

            return (
              <button
                key={recipe.id}
                type="button"
                onClick={() => setSelectedRecipeId(recipe.id)}
                className="w-full flex items-center justify-between px-4 py-3.5
                           active:bg-accent/30 transition-colors text-left"
              >
                {/* Name + portions */}
                <div className="min-w-0 flex-1 pr-3">
                  <p className="text-sm font-medium text-foreground truncate">
                    {recipe.name}
                    {recipe.portions != null && recipe.portions >= 1 && (
                      <span className="text-muted-foreground font-normal text-xs ml-1.5">
                        ({recipe.portions}p)
                      </span>
                    )}
                  </p>
                </div>

                {/* Ratio */}
                <div className="flex-shrink-0 w-14 text-right">
                  {ratio != null ? (
                    <span
                      className={cn(
                        "text-sm tabular-nums font-semibold",
                        isPartial
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground"
                      )}
                    >
                      {isPartial ? "≈ " : ""}x{ratio.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-sm tabular-nums text-muted-foreground/40">—</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail drawer */}
      <FoodCostMobileDetail
        open={selectedRecipe != null}
        onClose={() => setSelectedRecipeId(null)}
        recipe={selectedRecipe}
        result={selectedResult}
        typeName={
          selectedRecipe ? typeMap.get(selectedRecipe.recipe_type_id) ?? null : null
        }
      />
    </>
  );
}
