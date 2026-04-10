/**
 * Hook to fetch establishment's service_day_cutoff
 *
 * SINGLE SOURCE OF TRUTH for cutoff value in frontend.
 * Used by badge edit modals to correctly construct occurred_at timestamps.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_CUTOFF = "03:00";

export function useEstablishmentCutoff(establishmentId: string | null | undefined) {
  return useQuery({
    queryKey: ["establishment-cutoff", establishmentId],
    queryFn: async (): Promise<string> => {
      if (!establishmentId) {
        return DEFAULT_CUTOFF;
      }

      const { data, error } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      if (error) {
        if (import.meta.env.DEV) console.warn("Failed to fetch cutoff, using default:", error);
        return DEFAULT_CUTOFF;
      }

      // Extract HH:mm from TIME field (may be HH:mm:ss)
      const cutoff = data?.service_day_cutoff?.slice(0, 5) || DEFAULT_CUTOFF;
      return cutoff;
    },
    enabled: !!establishmentId,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — cutoff rarely changes
  });
}
