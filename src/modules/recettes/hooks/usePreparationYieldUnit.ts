/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Hook to get yield unit + siblings for a preparation
 * ═══════════════════════════════════════════════════════════════
 *
 * Returns the yield unit AND its physical siblings (kg↔g, L↔ml↔cl)
 * so the user can pick a convenient unit when using a sub-recipe.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface YieldUnitInfo {
  id: string;
  name: string;
  abbreviation: string;
}

/**
 * Physical sibling pairs — same as in useProductUnitsForRecipe.
 */
const PHYSICAL_SIBLINGS: Record<string, string[]> = {
  kg: ["g"],
  g: ["kg"],
  l: ["ml", "cl"],
  ml: ["l", "cl"],
  cl: ["l", "ml"],
};

export function usePreparationYieldUnit(recipeId: string | null) {
  const query = useQuery({
    queryKey: ["prep-yield-unit-siblings", recipeId],
    queryFn: async (): Promise<YieldUnitInfo[]> => {
      if (!recipeId) return [];
      // Get the recipe's yield_unit_id
      const { data: recipe, error: recipeErr } = await supabase
        .from("recipes")
        .select("yield_unit_id")
        .eq("id", recipeId)
        .maybeSingle();
      if (recipeErr || !recipe?.yield_unit_id) return [];

      const { data: unit, error: unitErr } = await supabase
        .from("measurement_units")
        .select("id, name, abbreviation")
        .eq("id", recipe.yield_unit_id)
        .maybeSingle();
      if (unitErr || !unit) return [];

      const baseUnit = unit as YieldUnitInfo;
      const units: YieldUnitInfo[] = [baseUnit];

      // Add physical siblings (g↔kg, ml↔cl↔L)
      const siblings = PHYSICAL_SIBLINGS[baseUnit.abbreviation.toLowerCase()];
      if (siblings && siblings.length > 0) {
        const { data: siblingUnits, error: sibErr } = await supabase
          .from("measurement_units")
          .select("id, name, abbreviation")
          .in("abbreviation", siblings);
        if (!sibErr && siblingUnits) {
          for (const s of siblingUnits) {
            if (s.id !== baseUnit.id) {
              units.push(s as YieldUnitInfo);
            }
          }
        }
      }

      return units;
    },
    enabled: !!recipeId,
    staleTime: 30 * 1000,
  });

  return {
    yieldUnit: query.data?.[0] ?? null,
    yieldUnits: query.data ?? [],
    isLoading: query.isLoading,
  };
}
