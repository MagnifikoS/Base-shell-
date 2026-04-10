/**
 * CRUD hook for recipe_types
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import type { RecipeType } from "../types";

const QUERY_KEY = "recipe-types";

export function useRecipeTypes() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [QUERY_KEY, estId],
    queryFn: async (): Promise<RecipeType[]> => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("recipe_types")
        .select("*")
        .eq("establishment_id", estId)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RecipeType[];
    },
    enabled: !!estId,
  });

  const createType = useMutation({
    mutationFn: async (input: string | { name: string; icon?: string }) => {
      if (!estId) throw new Error("No establishment");
      const name = typeof input === "string" ? input : input.name;
      const icon = typeof input === "string" ? "chef-hat" : (input.icon ?? "chef-hat");
      const maxOrder = (query.data ?? []).reduce(
        (max, t) => Math.max(max, t.display_order),
        -1
      );
      const { error } = await supabase.from("recipe_types").insert({
        establishment_id: estId,
        name: name.trim(),
        icon,
        display_order: maxOrder + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
      toast.success("Type de recette créé");
    },
    onError: () => toast.error("Erreur lors de la création"),
  });

  const updateType = useMutation({
    mutationFn: async ({ id, name, icon }: { id: string; name: string; icon?: string }) => {
      const updates: Record<string, unknown> = {
        name: name.trim(),
        updated_at: new Date().toISOString(),
      };
      if (icon !== undefined) updates.icon = icon;

      const { error } = await supabase
        .from("recipe_types")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
      toast.success("Type modifié");
    },
    onError: () => toast.error("Erreur lors de la modification"),
  });

  const deleteType = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("recipe_types")
        .delete()
        .eq("id", id);
      if (error) {
        if (error.code === "23503") {
          throw new Error("RESTRICT");
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
      toast.success("Type supprimé");
    },
    onError: (err: Error) => {
      if (err.message === "RESTRICT") {
        toast.error("Impossible de supprimer : des recettes utilisent ce type");
      } else {
        toast.error("Erreur lors de la suppression");
      }
    },
  });

  const reorderTypes = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      // Batch update display_order for each type
      const updates = orderedIds.map((id, index) =>
        supabase
          .from("recipe_types")
          .update({ display_order: index, updated_at: new Date().toISOString() })
          .eq("id", id)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
    },
    onError: () => toast.error("Erreur lors du réordonnancement"),
  });

  return {
    recipeTypes: query.data ?? [],
    isLoading: query.isLoading,
    createType,
    updateType,
    deleteType,
    reorderTypes,
  };
}
