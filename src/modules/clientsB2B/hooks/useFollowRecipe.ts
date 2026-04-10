/**
 * Hook pour suivre / ne plus suivre une recette B2B.
 * Opère uniquement sur b2b_followed_recipes — isolé du catalogue produit.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useFollowRecipe() {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const estId = activeEstablishment?.id;
  const qc = useQueryClient();

  const follow = useMutation({
    mutationFn: async (input: { listingId: string; partnershipId: string }) => {
      if (!estId || !user) throw new Error("No context");
      const { error } = await supabase.from("b2b_followed_recipes").insert({
        establishment_id: estId,
        listing_id: input.listingId,
        partnership_id: input.partnershipId,
        followed_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["b2b-recipe-catalogue"] });
      qc.invalidateQueries({ queryKey: ["b2b-followed-recipes"] });
      toast.success("Plat ajouté à vos plats fournisseurs");
    },
    onError: () => toast.error("Erreur lors de l'ajout"),
  });

  const unfollow = useMutation({
    mutationFn: async (listingId: string) => {
      if (!estId) throw new Error("No context");
      const { error } = await supabase
        .from("b2b_followed_recipes")
        .delete()
        .eq("establishment_id", estId)
        .eq("listing_id", listingId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["b2b-recipe-catalogue"] });
      qc.invalidateQueries({ queryKey: ["b2b-followed-recipes"] });
      toast.success("Plat retiré de vos plats fournisseurs");
    },
    onError: () => toast.error("Erreur lors du retrait"),
  });

  return { follow, unfollow };
}
