/**
 * CRUD hook for recipes + recipe_lines
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Recipe, RecipeLine, RecipeWithLines, SellingPriceMode } from "../types";

const QUERY_KEY = "recipes";

export function useRecipes() {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const estId = activeEstablishment?.id;
  const qc = useQueryClient();

  // ── List all recipes (without lines) ──
  const query = useQuery({
    queryKey: [QUERY_KEY, estId],
    queryFn: async (): Promise<Recipe[]> => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("establishment_id", estId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Recipe[];
    },
    enabled: !!estId,
  });

  // ── Get single recipe with lines ──
  const useRecipeDetail = (recipeId: string | undefined) =>
    useQuery({
      queryKey: [QUERY_KEY, "detail", recipeId],
      queryFn: async (): Promise<RecipeWithLines | null> => {
        if (!recipeId) return null;
        const { data, error } = await supabase
          .from("recipes")
          .select("*, recipe_lines!recipe_lines_recipe_id_fkey(*)")
          .eq("id", recipeId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        const recipe = data as RecipeWithLines;
        recipe.recipe_lines = (recipe.recipe_lines ?? []).sort(
          (a: RecipeLine, b: RecipeLine) => a.display_order - b.display_order
        );
        return recipe;
      },
      enabled: !!recipeId,
      retry: 2,
    });

  // ── Create recipe + lines atomically via RPC ──
  const createRecipe = useMutation({
    mutationFn: async (input: {
      name: string;
      recipe_type_id: string;
      is_preparation?: boolean;
      portions?: number | null;
      yield_quantity?: number | null;
      yield_unit_id?: string | null;
      selling_price?: number | null;
      selling_price_mode?: SellingPriceMode;
      lines: { product_id: string | null; sub_recipe_id?: string | null; quantity: number; unit_id: string }[];
    }) => {
      if (!estId || !user) throw new Error("No context");

      const linesPayload = input.lines.map((l) => ({
        product_id: l.sub_recipe_id ? null : l.product_id,
        sub_recipe_id: l.sub_recipe_id ?? null,
        quantity: l.quantity,
        unit_id: l.unit_id,
      }));

      const rpcParams = {
        _establishment_id: estId,
        _name: input.name.trim().toUpperCase(),
        _recipe_type_id: input.recipe_type_id,
        _created_by: user.id,
        _is_preparation: input.is_preparation ?? false,
        _portions: input.portions ?? null,
        _yield_quantity: input.yield_quantity ?? null,
        _yield_unit_id: input.yield_unit_id ?? null,
        _selling_price: input.selling_price ?? null,
        _selling_price_mode: input.selling_price_mode ?? "per_recipe",
        _lines: linesPayload,
      };

      const { data, error } = await supabase.rpc(
        "fn_create_recipe_full" as never,
        rpcParams as never
      );
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
      qc.invalidateQueries({ queryKey: ["food-cost-recipes", estId] });
      qc.invalidateQueries({ queryKey: ["preparations", estId] });
      toast.success("Recette créée");
    },
    onError: () => {
      toast.error("Erreur lors de la création");
    },
  });

  // ── Update recipe metadata ──
  const updateRecipe = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      recipe_type_id?: string;
      portions?: number | null;
      selling_price?: number | null;
      selling_price_mode?: SellingPriceMode;
      is_preparation?: boolean;
      yield_quantity?: number | null;
      yield_unit_id?: string | null;
    }) => {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.name !== undefined) updates.name = input.name.trim().toUpperCase();
      if (input.recipe_type_id !== undefined)
        updates.recipe_type_id = input.recipe_type_id;
      if ("portions" in input) updates.portions = input.portions ?? null;
      if ("selling_price" in input) updates.selling_price = input.selling_price ?? null;
      if ("selling_price_mode" in input) updates.selling_price_mode = input.selling_price_mode;
      if ("is_preparation" in input) updates.is_preparation = input.is_preparation;
      if ("yield_quantity" in input) updates.yield_quantity = input.yield_quantity ?? null;
      if ("yield_unit_id" in input) updates.yield_unit_id = input.yield_unit_id ?? null;

      const { error } = await supabase
        .from("recipes")
        .update(updates)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
      qc.invalidateQueries({ queryKey: [QUERY_KEY, "detail", v.id] });
      qc.invalidateQueries({ queryKey: ["food-cost-recipes", estId] });
      qc.invalidateQueries({ queryKey: ["preparations", estId] });
      toast.success("Recette modifiée");
    },
    onError: () => toast.error("Erreur lors de la modification"),
  });

  // ── Delete recipe ──
  const deleteRecipe = useMutation({
    mutationFn: async (id: string) => {
      // ── Garde-fou A : sous-recette utilisée ailleurs ──
      const { data: usages, error: usageErr } = await supabase
        .from("recipe_lines")
        .select("recipe_id, recipes!recipe_lines_recipe_id_fkey(name)")
        .eq("sub_recipe_id", id);

      if (usageErr) throw usageErr;

      if (usages && usages.length > 0) {
        const recipeNames = usages
          .map((u) => {
            const r = u.recipes as unknown as { name: string } | null;
            return r?.name ?? "Recette inconnue";
          })
          .filter((name, i, arr) => arr.indexOf(name) === i);
        throw new Error(
          `Cette préparation est utilisée dans : ${recipeNames.join(", ")}. Retirez-la de ces recettes avant de la supprimer.`
        );
      }

      // ── Garde-fou B : listing B2B exists → prevent deletion if published ──
      const { data: listing } = await supabase
        .from("b2b_recipe_listings")
        .select("id")
        .eq("recipe_id", id)
        .maybeSingle();

      if (listing) {
        // Listing exists — recipe was published B2B, block deletion
        throw new Error(
          "Impossible de supprimer cette recette : elle est publiée en B2B. Dépubliez-la et archivez-la."
        );
      }

      const { error } = await supabase.from("recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
      qc.invalidateQueries({ queryKey: ["preparations", estId] });
      toast.success("Recette supprimée");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erreur lors de la suppression");
    },
  });

  // ── Add a single line to existing recipe ──
  const addLine = useMutation({
    mutationFn: async (input: {
      recipe_id: string;
      product_id?: string | null;
      sub_recipe_id?: string | null;
      quantity: number;
      unit_id: string;
    }) => {
      const { data: existing } = await supabase
        .from("recipe_lines")
        .select("display_order")
        .eq("recipe_id", input.recipe_id)
        .order("display_order", { ascending: false })
        .limit(1);
      const nextOrder =
        existing && existing.length > 0 ? existing[0].display_order + 1 : 0;

      const insertData: Record<string, unknown> = {
        recipe_id: input.recipe_id,
        quantity: input.quantity,
        unit_id: input.unit_id,
        display_order: nextOrder,
      };

      if (input.sub_recipe_id) {
        insertData.sub_recipe_id = input.sub_recipe_id;
        insertData.product_id = null;
      } else {
        insertData.product_id = input.product_id;
      }

      const { error } = await supabase.from("recipe_lines").insert(insertData as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({
        queryKey: [QUERY_KEY, "detail", v.recipe_id],
      });
      qc.invalidateQueries({ queryKey: ["food-cost-recipes", estId] });
      toast.success("Ingrédient ajouté");
    },
    onError: () => toast.error("Erreur lors de l'ajout"),
  });

  // ── Update a line ──
  const updateLine = useMutation({
    mutationFn: async (input: {
      id: string;
      recipe_id: string;
      product_id?: string | null;
      sub_recipe_id?: string | null;
      quantity?: number;
      unit_id?: string;
    }) => {
      const updates: Record<string, unknown> = {};
      if (input.product_id !== undefined) updates.product_id = input.product_id;
      if (input.sub_recipe_id !== undefined) updates.sub_recipe_id = input.sub_recipe_id;
      if (input.quantity !== undefined) updates.quantity = input.quantity;
      if (input.unit_id !== undefined) updates.unit_id = input.unit_id;

      const { error } = await supabase
        .from("recipe_lines")
        .update(updates)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({
        queryKey: [QUERY_KEY, "detail", v.recipe_id],
      });
      qc.invalidateQueries({ queryKey: ["food-cost-recipes", estId] });
      toast.success("Ingrédient modifié");
    },
    onError: () => toast.error("Erreur lors de la modification"),
  });

  // ── Delete a line ──
  const deleteLine = useMutation({
    mutationFn: async (input: { id: string; recipe_id: string }) => {
      const { error } = await supabase
        .from("recipe_lines")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({
        queryKey: [QUERY_KEY, "detail", v.recipe_id],
      });
      toast.success("Ingrédient supprimé");
    },
    onError: () => toast.error("Erreur lors de la suppression"),
  });

  return {
    recipes: query.data ?? [],
    isLoading: query.isLoading,
    useRecipeDetail,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    addLine,
    updateLine,
    deleteLine,
  };
}
