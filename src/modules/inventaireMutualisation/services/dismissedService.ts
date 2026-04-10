/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Dismissed Suggestions Service
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Persists rejected suggestion hashes so they are never shown again.
 * Uses a deterministic hash of sorted product IDs.
 */

import { supabase } from "@/integrations/supabase/client";

/** Deterministic hash: sort product IDs and join */
export function computeSuggestionHash(productIds: string[]): string {
  return [...productIds].sort().join("|");
}

export async function fetchDismissedHashes(
  establishmentId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("inventory_mutualisation_dismissed")
    .select("product_ids_hash")
    .eq("establishment_id", establishmentId);

  if (error) throw error;
  return new Set((data ?? []).map((d) => d.product_ids_hash));
}

export async function dismissSuggestion(params: {
  establishmentId: string;
  productIds: string[];
  userId: string | null;
}): Promise<void> {
  const hash = computeSuggestionHash(params.productIds);

  const { error } = await supabase
    .from("inventory_mutualisation_dismissed")
    .upsert(
      {
        establishment_id: params.establishmentId,
        product_ids_hash: hash,
        dismissed_by: params.userId ?? undefined,
      },
      { onConflict: "establishment_id,product_ids_hash" }
    );

  if (error) throw error;
}
