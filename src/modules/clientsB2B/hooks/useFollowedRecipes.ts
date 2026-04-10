/**
 * Hook pour récupérer les recettes suivies par le client.
 * Utilise la RPC fn_get_b2b_followed_recipes (SECURITY DEFINER)
 * pour bypasser les RLS de la table recipes.
 * Opère uniquement sur b2b_followed_recipes — isolé de products_v2.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

export interface FollowedRecipe {
  id: string;
  listing_id: string;
  partnership_id: string;
  followed_at: string;
  recipe_name: string;
  recipe_type_name: string | null;
  recipe_type_icon: string | null;
  portions: number | null;
  b2b_price: number;
  supplier_name: string;
}

export function useFollowedRecipes() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["b2b-followed-recipes", estId],
    queryFn: async (): Promise<FollowedRecipe[]> => {
      if (!estId) return [];

      const { data, error } = await supabase.rpc(
        "fn_get_b2b_followed_recipes" as never,
        { _establishment_id: estId } as never
      );
      if (error) throw error;
      return (data ?? []) as FollowedRecipe[];
    },
    enabled: !!estId,
  });
}
