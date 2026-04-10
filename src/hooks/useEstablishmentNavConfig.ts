/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useEstablishmentNavConfig — Shared nav visibility config per establishment
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces localStorage-based mobileNavPrefs with DB-backed config.
 * Admin writes → establishment_nav_config table
 * All users read → same table (RLS scoped by user_roles)
 *
 * Returns a MobileNavPrefs-compatible object for seamless integration.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MobileNavPrefs } from "@/lib/mobileNavPrefs";

const QUERY_KEY = "establishment-nav-config";

/**
 * Read-only hook: returns hiddenIds for the active establishment
 */
export function useEstablishmentNavConfig(establishmentId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: [QUERY_KEY, establishmentId],
    queryFn: async (): Promise<MobileNavPrefs> => {
      if (!establishmentId) return { hiddenIds: [] };

      const { data, error } = await supabase
        .from("establishment_nav_config")
        .select("hidden_ids")
        .eq("establishment_id", establishmentId)
        .maybeSingle();

      if (error) {
        if (import.meta.env.DEV) console.error("[NavConfig] read error", error);
        return { hiddenIds: [] };
      }

      return { hiddenIds: data?.hidden_ids ?? [] };
    },
    enabled: !!establishmentId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  return {
    prefs: data ?? { hiddenIds: [] },
    isLoading,
  };
}

/**
 * Admin write hook: upsert hiddenIds for an establishment
 */
export function useEstablishmentNavConfigMutation(establishmentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (hiddenIds: string[]) => {
      if (!establishmentId) throw new Error("No establishment");

      const { error } = await supabase.from("establishment_nav_config").upsert(
        {
          establishment_id: establishmentId,
          hidden_ids: hiddenIds,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "establishment_id" }
      );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, establishmentId] });
    },
    onError: (error: Error) => {
      if (import.meta.env.DEV) console.error("[NavConfig] upsert error", error);
    },
  });
}
