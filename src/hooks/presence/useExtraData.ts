/**
 * Hook for fetching extra events data for admin view
 * V3.3: Monthly aggregation + detail by employee
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

export interface ExtraEvent {
  id: string;
  user_id: string;
  day_date: string;
  extra_minutes: number;
  status: "pending" | "approved" | "rejected";
  validated_by: string | null;
  validated_at: string | null;
  badge_event_id: string;
  establishment_id: string;
  organization_id: string;
  created_at: string;
  // V3.4.x: Time bounds for "de...à..." display
  extra_start_at?: string | null;
  extra_end_at?: string | null;
}

export interface ExtraEmployeeSummary {
  userId: string;
  fullName: string;
  approvedMinutes: number;
  pendingMinutes: number;
  pendingCount: number;
  /** Team ID for scope filtering (PER-MGR-009) */
  teamId: string | null;
}

export interface UseExtraDataResult {
  summaries: ExtraEmployeeSummary[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Get first and last day of a month (YYYY-MM format)
 */
function getMonthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;

  // Last day of month
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return { start, end };
}

/**
 * Fetch monthly extra summaries by employee
 * @param yearMonth - YYYY-MM format
 * @param params - Optional override for establishmentId (used by desktop admin)
 */
export function useExtraMonthlyData(
  yearMonth: string,
  params?: { establishmentId?: string | null }
): UseExtraDataResult {
  const { activeEstablishment } = useEstablishment();
  // Use override if provided (desktop admin), otherwise fallback to context (mobile)
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["extras", "monthly", establishmentId, yearMonth],
    queryFn: async (): Promise<ExtraEmployeeSummary[]> => {
      if (!establishmentId) return [];

      const { start, end } = getMonthBounds(yearMonth);

      // Fetch extra events for the month
      const { data: extras, error: extrasError } = await supabase
        .from("extra_events")
        .select("id, user_id, extra_minutes, status")
        .eq("establishment_id", establishmentId)
        .gte("day_date", start)
        .lte("day_date", end);

      if (extrasError) {
        throw new Error(`Failed to load extras: ${extrasError.message}`);
      }

      if (!extras || extras.length === 0) {
        return [];
      }

      // Get unique user IDs
      const userIds = [...new Set(extras.map((e) => e.user_id))];

      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      if (profilesError) {
        throw new Error(`Failed to load profiles: ${profilesError.message}`);
      }

      const profilesMap = new Map(
        (profiles || []).map((p) => [p.user_id, p.full_name || "Inconnu"])
      );

      // Fetch user teams for scope filtering (PER-MGR-009)
      const teamMap = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: userTeams } = await supabase
          .from("user_teams")
          .select("user_id, team_id, created_at")
          .in("user_id", userIds)
          .order("created_at", { ascending: true });

        if (userTeams) {
          for (const ut of userTeams) {
            // Only take first team per user (deterministic: oldest)
            if (!teamMap.has(ut.user_id)) {
              teamMap.set(ut.user_id, ut.team_id);
            }
          }
        }
      }

      // Aggregate by user
      const userAggregates = new Map<
        string,
        { approved: number; pending: number; pendingCount: number }
      >();

      for (const extra of extras) {
        const current = userAggregates.get(extra.user_id) || {
          approved: 0,
          pending: 0,
          pendingCount: 0,
        };

        if (extra.status === "approved") {
          current.approved += extra.extra_minutes;
        } else if (extra.status === "pending") {
          current.pending += extra.extra_minutes;
          current.pendingCount += 1;
        }

        userAggregates.set(extra.user_id, current);
      }

      // Build summaries
      const summaries: ExtraEmployeeSummary[] = [];
      for (const [userId, agg] of userAggregates) {
        summaries.push({
          userId,
          fullName: profilesMap.get(userId) || "Inconnu",
          approvedMinutes: agg.approved,
          pendingMinutes: agg.pending,
          pendingCount: agg.pendingCount,
          teamId: teamMap.get(userId) ?? null,
        });
      }

      // Sort by name
      summaries.sort((a, b) => a.fullName.localeCompare(b.fullName));

      return summaries;
    },
    enabled: !!establishmentId && !!yearMonth,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  return {
    summaries: query.data || [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/**
 * Fetch extra events detail for a specific employee in a month
 */
export interface UseExtraDetailResult {
  events: ExtraEvent[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * @param userId - Employee user ID
 * @param yearMonth - YYYY-MM format
 * @param params - Optional override for establishmentId (used by desktop admin)
 */
export function useExtraEmployeeDetail(
  userId: string | null,
  yearMonth: string,
  params?: { establishmentId?: string | null }
): UseExtraDetailResult {
  const { activeEstablishment } = useEstablishment();
  // Use override if provided (desktop admin), otherwise fallback to context (mobile)
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["extras", "detail", establishmentId, userId, yearMonth],
    queryFn: async (): Promise<ExtraEvent[]> => {
      if (!establishmentId || !userId) return [];

      const { start, end } = getMonthBounds(yearMonth);

      const { data, error } = await supabase
        .from("extra_events")
        .select(
          "id, user_id, day_date, extra_minutes, status, validated_by, validated_at, badge_event_id, establishment_id, organization_id, created_at, extra_start_at, extra_end_at"
        )
        .eq("establishment_id", establishmentId)
        .eq("user_id", userId)
        .gte("day_date", start)
        .lte("day_date", end)
        .order("day_date", { ascending: true });

      if (error) {
        throw new Error(`Failed to load extras: ${error.message}`);
      }

      return (data || []) as ExtraEvent[];
    },
    enabled: !!establishmentId && !!userId && !!yearMonth,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  return {
    events: query.data || [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
