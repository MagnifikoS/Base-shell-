import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { PlanningWeekData } from "../types/planning.types";

const QUERY_OPTIONS = {
  // PERF: 30s staleTime prevents redundant refetches during rapid week navigation.
  // Realtime invalidation still forces fresh data when shifts change.
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  // Only refetch on mount when data is stale (staleTime handles freshness)
  refetchOnMount: true as const,
  // STEP 4 — Warm-up: refetch every 8min to keep edge function warm
  // Prevents cold starts when user clicks after idle period.
  // Silent background refresh — does NOT cause loading spinners.
  refetchInterval: 8 * 60 * 1000, // 8 minutes
  refetchIntervalInBackground: false, // Stop when tab is hidden
  // Retry transient failures (network hiccups) but not auth/permission errors
  retry: (failureCount: number, error: Error) => {
    const msg = error.message || "";
    if (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("Forbidden") ||
      msg.includes("Unauthorized")
    ) {
      return false;
    }
    return failureCount < 2;
  },
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
  // TanStack Query v5: keep previous data during refetch for smooth week transitions
  placeholderData: (prev: PlanningWeekData | undefined) => prev,
};

interface FetchPlanningWeekOptions {
  establishmentId: string;
  weekStart: string;
  /** Optional team-based scope filter: when provided, only employees in these teams are returned.
   *  Intersected server-side with RBAC scope (never broadens access). */
  teamIds?: string[];
}

async function fetchPlanningWeek(options: FetchPlanningWeekOptions): Promise<PlanningWeekData> {
  // SESSION GUARD: Ensure we have a valid session before calling the edge function.
  // This prevents 401 spam when the session is expired (especially on mobile wake-up).
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // Try to refresh the session once
    const { data: { session: refreshed }, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed) {
      throw new Error("Session expirée — reconnectez-vous");
    }
  }

  const body: Record<string, unknown> = {
    action: "get_week",
    establishment_id: options.establishmentId,
    week_start: options.weekStart,
  };

  // PER-EMP-029: Only send team_ids when explicitly provided
  if (options.teamIds && options.teamIds.length > 0) {
    body.team_ids = options.teamIds;
  }

  const { data, error } = await supabase.functions.invoke("planning-week", {
    body,
  });

  if (error) {
    throw new Error(error.message || "Erreur lors du chargement du planning");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data as PlanningWeekData;
}

/**
 * Fetch planning week data with optional team-based scope filtering.
 *
 * @param establishmentId - The establishment to fetch planning for
 * @param weekStart - ISO date string for the Monday of the week
 * @param teamIds - Optional array of team UUIDs to filter employees server-side.
 *                  When omitted, returns all employees within the user's RBAC scope.
 */
export function usePlanningWeek(
  establishmentId: string | null,
  weekStart: string | null,
  teamIds?: string[]
) {
  const { session } = useAuth();
  // Include teamIds in query key so React Query caches per-team results separately
  const teamKey = teamIds && teamIds.length > 0 ? teamIds.slice().sort().join(",") : "all";

  return useQuery<PlanningWeekData, Error>({
    queryKey: ["planning-week", establishmentId, weekStart, teamKey],
    queryFn: () => {
      if (!establishmentId || !weekStart) {
        throw new Error("Missing parameters");
      }
      return fetchPlanningWeek({
        establishmentId,
        weekStart,
        teamIds,
      });
    },
    // SESSION GUARD: Don't fire queries when there's no active session
    enabled: !!establishmentId && !!weekStart && !!session,
    ...QUERY_OPTIONS,
  });
}
