/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Data hook (batch-load + compute)
 * ═══════════════════════════════════════════════════════════════
 *
 * V1.1: supports sub-recipe lines (preparations)
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnitConversions } from "@/core/unitConversion/useUnitConversions";
import { computeRecipeCost } from "../engine/foodCostEngine";
import type { SubRecipeCostData } from "../engine/foodCostEngine";
import type { FoodCostProduct } from "../types";
import type { RecipeCostResult, CostStatus } from "../types";

interface RecipeRow {
  id: string;
  name: string;
  recipe_type_id: string;
  establishment_id: string;
  portions: number | null;
  selling_price: number | null;
  selling_price_mode: string;
  is_preparation: boolean;
  yield_quantity: number | null;
  yield_unit_id: string | null;
  recipe_lines: {
    id: string;
    product_id: string | null;
    sub_recipe_id: string | null;
    quantity: number;
    unit_id: string;
  }[];
}

export function useFoodCostData() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const recipesQuery = useQuery({
    queryKey: ["food-cost-recipes", estId],
    queryFn: async (): Promise<RecipeRow[]> => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, recipe_type_id, establishment_id, portions, selling_price, selling_price_mode, is_preparation, yield_quantity, yield_unit_id, recipe_lines!recipe_lines_recipe_id_fkey(id, product_id, sub_recipe_id, quantity, unit_id)")
        .eq("establishment_id", estId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RecipeRow[];
    },
    enabled: !!estId,
  });

  const productIds = useMemo(() => {
    if (!recipesQuery.data) return [];
    const ids = new Set<string>();
    for (const r of recipesQuery.data) {
      for (const l of r.recipe_lines) {
        if (l.product_id) ids.add(l.product_id);
      }
    }
    return Array.from(ids);
  }, [recipesQuery.data]);

  const productsQuery = useQuery({
    queryKey: ["food-cost-products", estId, productIds],
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

  const productsMap = useMemo(() => {
    const map = new Map<string, FoodCostProduct>();
    for (const p of productsQuery.data ?? []) {
      map.set(p.id, p);
    }
    return map;
  }, [productsQuery.data]);

  const costResults = useMemo((): Map<string, RecipeCostResult> => {
    const map = new Map<string, RecipeCostResult>();
    if (!recipesQuery.data) return map;

    const allRecipes = recipesQuery.data;

    // Step 1: Compute preparations first (they have no sub-recipe lines in V1)
    const subRecipeCosts = new Map<string, SubRecipeCostData>();
    for (const recipe of allRecipes) {
      if (!recipe.is_preparation) continue;

      const input = {
        ...recipe,
        recipe_lines: recipe.recipe_lines.filter((l) => l.product_id),
        selling_price_mode: (recipe.selling_price_mode === "per_portion" ? "per_portion" : "per_recipe") as "per_recipe" | "per_portion",
      };
      const result = computeRecipeCost(input, productsMap, units, conversions);
      map.set(recipe.id, result);

      // Store for sub-recipe cost lookup
      if (recipe.yield_quantity && recipe.yield_unit_id) {
        subRecipeCosts.set(recipe.id, {
          totalCost: result.totalCost,
          yieldQuantity: recipe.yield_quantity,
          yieldUnitId: recipe.yield_unit_id,
          status: result.status as CostStatus,
        });
      }
    }

    // Step 2: Compute dishes (can reference preparations)
    for (const recipe of allRecipes) {
      if (recipe.is_preparation) continue;

      const input = {
        ...recipe,
        selling_price_mode: (recipe.selling_price_mode === "per_portion" ? "per_portion" : "per_recipe") as "per_recipe" | "per_portion",
      };
      const result = computeRecipeCost(input, productsMap, units, conversions, subRecipeCosts);
      map.set(recipe.id, result);
    }

    return map;
  }, [recipesQuery.data, productsMap, units, conversions]);

  const isLoading =
    recipesQuery.isLoading || productsQuery.isLoading || unitsLoading;

  return {
    recipes: recipesQuery.data ?? [],
    costResults,
    isLoading,
    refetch: recipesQuery.refetch,
  };
}
