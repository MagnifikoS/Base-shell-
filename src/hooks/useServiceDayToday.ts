/**
 * Hook to get the current "service day" for a given establishment.
 *
 * SINGLE SOURCE OF TRUTH: Uses the backend RPC `get_service_day_now(establishment_id)`
 * which respects the establishment's `service_day_cutoff` parameter.
 *
 * IMPORTANT: No local date calculations here. The backend decides the day.
 *
 * Previously located in src/modules/cash/hooks/useBusinessDayToday.ts.
 * Moved to shared hooks because it is used across multiple modules
 * (cash, planning, badgeuse, presence, conges).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch the current service day for a specific establishment.
 * This is the ONLY place that determines "today" for service-day-aware modules.
 *
 * @param establishmentId - The establishment UUID
 * @returns Query result with YYYY-MM-DD string
 */
export function useServiceDayToday(establishmentId: string | null) {
  return useQuery({
    queryKey: ["service-day-today", establishmentId],
    queryFn: async (): Promise<string> => {
      if (!establishmentId) {
        throw new Error("No establishment selected");
      }

      const { data, error } = await supabase.rpc("get_service_day_now", {
        _establishment_id: establishmentId,
      });

      if (error) {
        if (import.meta.env.DEV) console.error("Error fetching service day:", error);
        throw error;
      }

      // RPC returns YYYY-MM-DD
      if (!data || typeof data !== "string") {
        throw new Error("Invalid service day returned by backend");
      }

      return data;
    },
    enabled: !!establishmentId,
    // Service day changes at most once per day — cache for 10 minutes to avoid redundant RPCs.
    // refetchInterval ensures eventual consistency, refetchOnWindowFocus catches tab-resume.
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
  });
}
