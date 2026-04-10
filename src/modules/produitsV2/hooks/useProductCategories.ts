/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — useProductCategories Hook (SSOT = product_categories table)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Source unique de vérité pour les catégories produit.
 * Lit depuis la table product_categories (is_archived = false).
 *
 * ROLLBACK: Supprimer ce fichier + restaurer useCategoriesV2.ts
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

export interface ProductCategory {
  id: string;
  name: string;
}

export function useProductCategories() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;

  const {
    data: categories = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["product_categories", establishmentId],
    queryFn: async (): Promise<ProductCategory[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name")
        .eq("establishment_id", establishmentId)
        .eq("is_archived", false)
        .order("name", { ascending: true });

      if (error) {
        if (import.meta.env.DEV)
          console.error("[useProductCategories] Error fetching categories:", error);
        return [];
      }

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
      }));
    },
    enabled: !!establishmentId,
    staleTime: 30 * 60 * 1000, // Reference data — rarely changes
  });

  // Extraire juste les noms pour rétro-compatibilité avec les composants existants
  const categoryNames = categories.map((c) => c.name);

  /**
   * Vérifie si une valeur legacy existe dans la liste SSOT
   * Comparaison case-insensitive + trim
   */
  const findMatchingCategory = (legacyValue: string | null | undefined): ProductCategory | null => {
    if (!legacyValue || legacyValue.trim() === "") return null;

    const normalized = legacyValue.trim().toLowerCase();
    return categories.find((c) => c.name.toLowerCase() === normalized) ?? null;
  };

  /**
   * Vérifie si une valeur est "legacy" (existe dans le produit mais pas dans SSOT)
   */
  const isLegacyValue = (value: string | null | undefined): boolean => {
    if (!value || value.trim() === "") return false;
    return findMatchingCategory(value) === null;
  };

  return {
    /** Liste complète avec id + name */
    categories,
    /** Juste les noms (rétro-compatibilité) */
    categoryNames,
    isLoading,
    error,
    /** Vérifie si une valeur legacy match une catégorie SSOT */
    findMatchingCategory,
    /** Vérifie si une valeur est legacy (pas dans SSOT) */
    isLegacyValue,
    /** Vrai si aucune catégorie configurée */
    isEmpty: categories.length === 0 && !isLoading,
  };
}
