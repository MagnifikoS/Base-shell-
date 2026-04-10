/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Hook to compute a preparation's unit cost
 * ═══════════════════════════════════════════════════════════════
 *
 * Returns: { unitCost, totalCost, yieldQty, yieldUnitId, status }
 * Used by the food cost engine for sub-recipe lines.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUnitConversions } from "@/core/unitConversion/useUnitConversions";
import { computeRecipeCost } from "@/modules/foodCost/engine/foodCostEngine";
import type { FoodCostProduct } from "@/modules/foodCost/types";

interface PrepCostResult {
  totalCost: number;
  unitCost: number | null;
  yieldQuantity: number | null;
  yieldUnitId: string | null;
  status: string;
}

export function usePreparationCost(recipeId: string | undefined): PrepCostResult & { isLoading: boolean } {
  const recipeQuery = useQuery({
    queryKey: ["prep-cost-recipe", recipeId],
    queryFn: async () => {
      if (!recipeId) return null;
      const { data, error } = await supabase
        .from("recipes")
        .select("id, portions, selling_price, selling_price_mode, yield_quantity, yield_unit_id, recipe_lines(id, product_id, quantity, unit_id)")
        .eq("id", recipeId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return data;
    },
    enabled: !!recipeId,
    staleTime: 5 * 60 * 1000,
  });

  const productIds = useMemo(() => {
    if (!recipeQuery.data?.recipe_lines) return [];
    return recipeQuery.data.recipe_lines
      .filter((l: { product_id: string | null }) => l.product_id)
      .map((l: { product_id: string }) => l.product_id);
  }, [recipeQuery.data]);

  const productsQuery = useQuery({
    queryKey: ["prep-cost-products", productIds],
    queryFn: async (): Promise<FoodCostProduct[]> => {
      if (productIds.length === 0) return [];
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, nom_produit, final_unit_price, final_unit_id, conditionnement_config")
        .in("id", productIds);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        conditionnement_config: p.conditionnement_config
          ? typeof p.conditionnement_config === "string"
            ? JSON.parse(p.conditionnement_config)
            : p.conditionnement_config
          : null,
      })) as FoodCostProduct[];
    },
    enabled: productIds.length > 0,
  });

  const { units, conversions, isLoading: unitsLoading } = useUnitConversions();

  const result = useMemo((): PrepCostResult => {
    if (!recipeQuery.data) {
      return { totalCost: 0, unitCost: null, yieldQuantity: null, yieldUnitId: null, status: "vide" };
    }

    const productsMap = new Map<string, FoodCostProduct>();
    for (const p of productsQuery.data ?? []) {
      productsMap.set(p.id, p);
    }

    const recipe = recipeQuery.data;
    const costResult = computeRecipeCost(
      {
        id: recipe.id,
        recipe_lines: (recipe.recipe_lines ?? []).filter((l: { product_id: string | null }) => l.product_id),
        portions: recipe.portions,
        selling_price: recipe.selling_price,
        selling_price_mode: (recipe.selling_price_mode === "per_portion" ? "per_portion" : "per_recipe") as "per_recipe" | "per_portion",
      },
      productsMap,
      units,
      conversions
    );

    const yieldQty = recipe.yield_quantity as number | null;
    const unitCost = yieldQty && yieldQty > 0 && costResult.totalCost > 0
      ? costResult.totalCost / yieldQty
      : null;

    return {
      totalCost: costResult.totalCost,
      unitCost,
      yieldQuantity: yieldQty,
      yieldUnitId: recipe.yield_unit_id as string | null,
      status: costResult.status,
    };
  }, [recipeQuery.data, productsQuery.data, units, conversions]);

  return {
    ...result,
    isLoading: recipeQuery.isLoading || productsQuery.isLoading || unitsLoading,
  };
}
