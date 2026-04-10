/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Suggestion Engine Hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reads products_v2 (READ-ONLY) for the current establishment and
 * identifies clusters of similar products sharing:
 *   1. Same category_id
 *   2. Same stock_handling_unit_id
 *   3. Same storage_zone_id
 *   4. Jaccard name similarity ≥ 0.5
 *
 * Returns SuggestedGroup[] — NO writes, NO side-effects on products.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  extractKernel,
  jaccardSimilarity,
  SIMILARITY_THRESHOLD,
} from "../utils/nameKernel";
import type { MutualisableProduct, SuggestedGroup } from "../types";

/**
 * Build a human-friendly group name from the common kernel tokens.
 */
function buildGroupName(kernelTokens: Set<string>): string {
  const sorted = Array.from(kernelTokens).sort();
  if (sorted.length === 0) return "Groupe sans nom";
  return sorted.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" ");
}

/**
 * Core clustering logic — pure function, easy to unit-test.
 */
export function clusterProducts(
  products: MutualisableProduct[]
): SuggestedGroup[] {
  // Group products by (category_id, stock_handling_unit_id, storage_zone_id)
  const buckets = new Map<string, MutualisableProduct[]>();

  for (const p of products) {
    const key = `${p.category_id ?? "null"}|${p.stock_handling_unit_id ?? "null"}|${p.storage_zone_id ?? "null"}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }

  const suggestions: SuggestedGroup[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    // Compute kernels
    const kernels = bucket.map((p) => ({
      product: p,
      kernel: extractKernel(p.nom_produit),
    }));

    // Union-Find–style clustering via pairwise similarity
    const visited = new Set<number>();

    for (let i = 0; i < kernels.length; i++) {
      if (visited.has(i)) continue;

      const cluster: number[] = [i];
      visited.add(i);

      for (let j = i + 1; j < kernels.length; j++) {
        if (visited.has(j)) continue;
        if (
          jaccardSimilarity(kernels[i].kernel, kernels[j].kernel) >=
          SIMILARITY_THRESHOLD
        ) {
          cluster.push(j);
          visited.add(j);
        }
      }

      if (cluster.length < 2) continue;

      // Compute shared kernel for group name
      let sharedKernel = new Set(kernels[cluster[0]].kernel);
      for (let c = 1; c < cluster.length; c++) {
        const next = kernels[cluster[c]].kernel;
        sharedKernel = new Set([...sharedKernel].filter((t) => next.has(t)));
      }

      suggestions.push({
        displayName: buildGroupName(sharedKernel),
        productIds: cluster.map((idx) => kernels[idx].product.id),
        products: cluster.map((idx) => ({
          id: kernels[idx].product.id,
          nom_produit: kernels[idx].product.nom_produit,
          supplier_name: kernels[idx].product.supplier_name,
        })),
      });
    }
  }

  return suggestions;
}

// ── React hook ───────────────────────────────────────────────────────────

export function useSuggestGroups() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;

  return useQuery({
    queryKey: ["mutualisation-suggestions", establishmentId],
    enabled: !!establishmentId,
    staleTime: 5 * 60_000, // 5 min cache — suggestions don't change often
    queryFn: async (): Promise<SuggestedGroup[]> => {
      // Read products (READ-ONLY, no mutation)
      const { data: rawData, error } = await supabase
        .from("products_v2")
        .select(
          "id, nom_produit, category_id, stock_handling_unit_id, storage_zone_id, supplier_id, invoice_suppliers!supplier_id(name)"
        )
        .eq("establishment_id", establishmentId!)
        .is("archived_at", null);
      const data = (rawData ?? []).map((p) => ({
        ...p,
        supplier_name: (p.invoice_suppliers as { name: string } | null)?.name ?? null,
      }));

      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Also fetch existing group members to exclude already-grouped products
      const { data: existingMembers } = await supabase
        .from("inventory_mutualisation_members")
        .select("product_id, group_id")
        .in(
          "group_id",
          (
            await supabase
              .from("inventory_mutualisation_groups")
              .select("id")
              .eq("establishment_id", establishmentId!)
              .eq("is_active", true)
          ).data?.map((g) => g.id) ?? []
        );

      const alreadyGrouped = new Set(
        (existingMembers ?? []).map((m) => m.product_id)
      );

      const ungrouped = (data as MutualisableProduct[]).filter(
        (p) => !alreadyGrouped.has(p.id)
      );

      return clusterProducts(ungrouped);
    },
  });
}
