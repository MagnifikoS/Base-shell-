/**
 * useEstablishmentNames — Resolves partner establishment names
 * using the SECURITY DEFINER RPC fn_get_b2b_partner_profile.
 *
 * This avoids cross-tenant RLS issues: a client can resolve a
 * supplier name (and vice versa) as long as an active partnership exists.
 *
 * Falls back to a direct SELECT for own-org establishments (always readable).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useEstablishmentNames(ids: string[]) {
  return useQuery({
    queryKey: ["establishment-names-v2", ids],
    queryFn: async (): Promise<Record<string, string>> => {
      if (ids.length === 0) return {};

      const names: Record<string, string> = {};

      // 1. Try direct SELECT first (works for own-org establishments)
      const { data: ownData } = await supabase
        .from("establishments")
        .select("id, name, trade_name")
        .in("id", ids);

      const resolved = new Set<string>();
      if (ownData) {
        for (const e of ownData) {
          names[e.id] = e.trade_name || e.name;
          resolved.add(e.id);
        }
      }

      // 2. For unresolved IDs (cross-tenant), use the SECURITY DEFINER RPC
      const unresolvedIds = ids.filter((id) => !resolved.has(id));

      if (unresolvedIds.length > 0) {
        const results = await Promise.allSettled(
          unresolvedIds.map(async (id) => {
            const { data } = await supabase.rpc("fn_get_b2b_partner_profile", {
              p_partner_establishment_id: id,
            });
            // data is Json: { ok: true, name, trade_name, ... } or { ok: false }
            const profile = data as { ok: boolean; name?: string; trade_name?: string } | null;
            if (profile?.ok && profile.name) {
              names[id] = profile.trade_name || profile.name;
            }
          })
        );
        // Silently ignore failures — name stays unresolved → UI shows fallback
      }

      return names;
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}
