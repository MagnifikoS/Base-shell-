/**
 * Hook dédié au catalogue recettes B2B.
 * Appelle la RPC fn_get_b2b_recipe_catalogue.
 * Domaine isolé — ne touche pas au catalogue produit.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface B2BRecipeCatalogItem {
  listing_id: string;
  recipe_id: string;
  recipe_name: string;
  recipe_type_name: string | null;
  recipe_type_icon: string | null;
  portions: number | null;
  b2b_price: number;
  is_followed: boolean;
}

export function useB2BRecipeCatalog(supplierEstablishmentId: string | undefined) {
  return useQuery({
    queryKey: ["b2b-recipe-catalogue", supplierEstablishmentId],
    queryFn: async (): Promise<B2BRecipeCatalogItem[]> => {
      if (!supplierEstablishmentId) return [];
      const { data, error } = await supabase.rpc(
        "fn_get_b2b_recipe_catalogue" as never,
        { _supplier_establishment_id: supplierEstablishmentId } as never
      );
      if (error) throw error;
      return (data ?? []) as B2BRecipeCatalogItem[];
    },
    enabled: !!supplierEstablishmentId,
  });
}
