/**
 * Hook pour gérer le listing B2B d'une recette (publication + fiche plat commerciale).
 * Domaine isolé : ne touche ni products_v2, ni commandes, ni food cost.
 *
 * Étape 2 — La fiche plat commerciale porte désormais :
 *   commercial_name, portions, recipe_type_id, b2b_price, is_published
 *
 * Règle clé : à la première publication on snapshotte depuis la recette source.
 * Ensuite, la fiche commerciale est éditée de manière autonome.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

const QK = "b2b-recipe-listing";

export interface RecipeB2BListing {
  id: string;
  establishment_id: string;
  recipe_id: string;
  is_published: boolean;
  b2b_price: number;
  commercial_name: string;
  portions: number | null;
  recipe_type_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertB2BListingInput {
  is_published: boolean;
  b2b_price: number;
  commercial_name: string;
  portions: number | null;
  recipe_type_id: string | null;
}

export function useRecipeB2BListing(recipeId: string | undefined) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [QK, recipeId],
    queryFn: async (): Promise<RecipeB2BListing | null> => {
      if (!recipeId || !estId) return null;
      const { data, error } = await supabase
        .from("b2b_recipe_listings")
        .select("*")
        .eq("establishment_id", estId)
        .eq("recipe_id", recipeId)
        .maybeSingle();
      if (error) throw error;
      return data as RecipeB2BListing | null;
    },
    enabled: !!recipeId && !!estId,
  });

  const upsert = useMutation({
    mutationFn: async (input: UpsertB2BListingInput) => {
      if (!recipeId || !estId) throw new Error("No context");
      const { error } = await supabase
        .from("b2b_recipe_listings")
        .upsert(
          {
            establishment_id: estId,
            recipe_id: recipeId,
            is_published: input.is_published,
            b2b_price: input.b2b_price,
            commercial_name: input.commercial_name,
            portions: input.portions ?? null,
            recipe_type_id: input.recipe_type_id ?? null,
          },
          { onConflict: "establishment_id,recipe_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK, recipeId] });
    },
  });

  return {
    listing: query.data ?? null,
    isLoading: query.isLoading,
    upsert,
  };
}
