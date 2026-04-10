/**
 * useStaleLitiges — Detects product disputes stuck in "open" status > 72h.
 * Monitoring-only hook, no mutations.
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface StaleLitige {
  id: string;
  commande_id: string;
  status: string;
  created_at: string;
}

export function useStaleLitiges() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["litiges", "stale", estId],
    queryFn: async (): Promise<StaleLitige[]> => {
      const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const { data, error } = await db
        .from("litiges")
        .select("id, commande_id, status, created_at, commandes!inner(client_establishment_id, supplier_establishment_id)")
        .eq("status", "open")
        .lt("created_at", cutoff)
        .or(
          `commandes.client_establishment_id.eq.${estId},commandes.supplier_establishment_id.eq.${estId}`
        )
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) throw error;
      const results = (data ?? []) as StaleLitige[];

      if (results.length > 0 && import.meta.env.DEV) {
        console.warn(`[Monitoring] ${results.length} litiges ouverts > 72h`, results.map((r) => r.id));
      }

      return results;
    },
    enabled: !!estId,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
