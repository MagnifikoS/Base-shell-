/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Hook for fetching preparations (is_preparation=true)
 * ═══════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { Recipe } from "../types";

export function usePreparations() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["preparations", estId],
    queryFn: async (): Promise<Recipe[]> => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("establishment_id", estId)
        .eq("is_preparation", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Recipe[];
    },
    enabled: !!estId,
  });

  return {
    preparations: query.data ?? [],
    isLoading: query.isLoading,
  };
}
