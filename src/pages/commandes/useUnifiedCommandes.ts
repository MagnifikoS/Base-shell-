/**
 * useUnifiedCommandes — Fetches product commandes as a chronological list.
 * Pure product-only flow (dish orders removed).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import type { Commande, CommandeStatus } from "@/modules/commandes/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* ── Extend Commande with resolved names (page-level concern) ── */

export interface ProductCommandeResolved extends Commande {
  created_by_name?: string | null;
  shipped_by_name?: string | null;
  received_by_name?: string | null;
}

/* ── Discriminated union (product-only) ── */

export interface UnifiedProductItem {
  kind: "produit";
  data: ProductCommandeResolved;
  sortDate: string;
}

export type UnifiedItem = UnifiedProductItem;

/* ── Hook: fetch products commandes at page level ── */

function useProductCommandes() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["unified-commandes-products", estId],
    queryFn: async (): Promise<ProductCommandeResolved[]> => {
      const { data, error } = await db
        .from("commandes")
        .select("*")
        .or(`client_establishment_id.eq.${estId},supplier_establishment_id.eq.${estId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const commandes = (data ?? []) as ProductCommandeResolved[];

      // Resolve actor names
      const ids = commandes.map((c) => c.id);
      if (ids.length > 0) {
        const { data: resolved } = await db.rpc("resolve_commande_actors", { p_ids: ids });
        if (resolved) {
          const nameMap = new Map<string, string>();
          for (const r of resolved as { user_id: string; display_name: string }[]) {
            if (r.display_name) nameMap.set(r.user_id, r.display_name);
          }
          for (const c of commandes) {
            c.created_by_name = nameMap.get(c.created_by) ?? null;
            c.shipped_by_name = c.shipped_by ? (nameMap.get(c.shipped_by) ?? null) : null;
            c.received_by_name = c.received_by ? (nameMap.get(c.received_by) ?? null) : null;
          }
        }
      }
      return commandes;
    },
    enabled: !!estId,
    staleTime: 60_000,
  });
}

/* ── Product list ── */

export function useUnifiedCommandes() {
  const products = useProductCommandes();

  const items = useMemo<UnifiedItem[]>(() => {
    const list: UnifiedItem[] = (products.data ?? []).map((p) => ({
      kind: "produit" as const,
      data: p,
      sortDate: p.sent_at ?? p.created_at,
    }));

    list.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
    return list;
  }, [products.data]);

  return {
    items,
    isLoading: products.isLoading,
  };
}

/* ── Status check helpers ── */

export function getUnifiedStatus(item: UnifiedItem): string {
  return item.data.status;
}

export function isEnCours(status: string): boolean {
  return ["brouillon", "envoyee", "ouverte", "expediee"].includes(status);
}
