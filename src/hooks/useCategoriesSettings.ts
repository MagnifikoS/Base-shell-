/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useCategoriesSettings — CRUD hook for product_categories (Settings hub)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT = product_categories table.
 * Same source as useProductCategories (produitsV2 module) but with
 * write operations (create, rename, archive, restore).
 *
 * Query key aligned: ["product_categories", establishmentId]
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";

interface CategoryRow {
  id: string;
  name: string;
  is_archived: boolean;
}

export function useCategoriesSettings(includeArchived: boolean) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;
  const organizationId = activeEstablishment?.organization_id ?? null;
  const queryClient = useQueryClient();

  const { data: allCategories = [], isLoading } = useQuery({
    queryKey: ["product_categories", establishmentId, includeArchived ? "all" : "active"],
    queryFn: async (): Promise<CategoryRow[]> => {
      if (!establishmentId) return [];

      let query = supabase
        .from("product_categories")
        .select("id, name, is_archived")
        .eq("establishment_id", establishmentId)
        .order("name", { ascending: true });

      if (!includeArchived) {
        query = query.eq("is_archived", false);
      }

      const { data, error } = await query;
      if (error) {
        if (import.meta.env.DEV) console.error("[useCategoriesSettings]", error);
        return [];
      }
      return data ?? [];
    },
    enabled: !!establishmentId,
    staleTime: 30_000,
  });

  const activeCategories = allCategories.filter((c) => !c.is_archived);
  const archivedCategories = allCategories.filter((c) => c.is_archived);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["product_categories", establishmentId] });
  };

  const createCategory = async (name: string): Promise<boolean> => {
    if (!establishmentId || !organizationId) return false;

    const normalized = name.trim().toLowerCase();

    // Check duplicate
    const existing = activeCategories.find((c) => c.name.toLowerCase() === normalized);
    if (existing) {
      toast.error("Cette catégorie existe déjà");
      return false;
    }

    const { error } = await supabase.from("product_categories").insert({
      establishment_id: establishmentId,
      organization_id: organizationId,
      name: name.trim(),
      name_normalized: normalized,
    });

    if (error) {
      toast.error("Erreur lors de la création");
      if (import.meta.env.DEV) console.error("[createCategory]", error);
      return false;
    }

    toast.success("Catégorie créée");
    invalidate();
    return true;
  };

  const renameCategory = async (id: string, newName: string): Promise<boolean> => {
    const normalized = newName.trim().toLowerCase();

    // Check duplicate (exclude self)
    const existing = activeCategories.find(
      (c) => c.id !== id && c.name.toLowerCase() === normalized
    );
    if (existing) {
      toast.error("Ce nom de catégorie est déjà utilisé");
      return false;
    }

    const { error } = await supabase
      .from("product_categories")
      .update({ name: newName.trim(), name_normalized: normalized, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Erreur lors du renommage");
      if (import.meta.env.DEV) console.error("[renameCategory]", error);
      return false;
    }

    toast.success("Catégorie renommée");
    invalidate();
    return true;
  };

  const archiveCategory = async (id: string): Promise<boolean> => {
    const { error } = await supabase
      .from("product_categories")
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Erreur lors de l'archivage");
      return false;
    }

    toast.success("Catégorie archivée");
    invalidate();
    return true;
  };

  const restoreCategory = async (id: string): Promise<boolean> => {
    const { error } = await supabase
      .from("product_categories")
      .update({ is_archived: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Erreur lors de la restauration");
      return false;
    }

    toast.success("Catégorie restaurée");
    invalidate();
    return true;
  };

  return {
    activeCategories,
    archivedCategories,
    isLoading,
    createCategory,
    renameCategory,
    archiveCategory,
    restoreCategory,
  };
}
