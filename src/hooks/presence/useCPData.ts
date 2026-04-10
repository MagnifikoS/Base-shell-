/**
 * Hook for fetching CP (Congés Payés) data for admin view
 * Fetch-only: no business logic, UI displays day counts
 * Source: personnel_leaves (leave_type="cp", status="approved")
 *
 * TODO: Plus tard : fusionner CP planning + CP validés via demandes paie
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

export interface CPEmployeeSummary {
  userId: string;
  fullName: string;
  cpDaysCount: number;
  firstDate: string; // YYYY-MM-DD
  lastDate: string;  // YYYY-MM-DD
}

export interface UseCPDataResult {
  users: CPEmployeeSummary[];
  totalCpDays: number;
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
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/**
 * Fetch monthly CP summaries by employee
 * @param yearMonth - YYYY-MM format
 * @param params - Optional override for establishmentId
 */
export function useCPMonthlyData(
  yearMonth: string,
  params?: { establishmentId?: string | null }
): UseCPDataResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["cp", "monthly", establishmentId, yearMonth],
    queryFn: async (): Promise<{ users: CPEmployeeSummary[]; totalCpDays: number }> => {
      if (!establishmentId) return { users: [], totalCpDays: 0 };

      const { start, end } = getMonthBounds(yearMonth);

      // Fetch CP leaves only (leave_type="cp", status="approved")
      const { data: cpLeaves, error: cpError } = await supabase
        .from("personnel_leaves")
        .select("user_id, leave_date")
        .eq("establishment_id", establishmentId)
        .eq("status", "approved")
        .eq("leave_type", "cp") // Only CP
        .gte("leave_date", start)
        .lte("leave_date", end);

      if (cpError) {
        throw new Error(`Failed to load CP leaves: ${cpError.message}`);
      }

      if (!cpLeaves || cpLeaves.length === 0) {
        return { users: [], totalCpDays: 0 };
      }

      // Aggregate by user (count days + date range)
      const userAgg = new Map<string, { count: number; minDate: string; maxDate: string }>();
      for (const leave of cpLeaves) {
        const prev = userAgg.get(leave.user_id);
        if (prev) {
          prev.count += 1;
          if (leave.leave_date < prev.minDate) prev.minDate = leave.leave_date;
          if (leave.leave_date > prev.maxDate) prev.maxDate = leave.leave_date;
        } else {
          userAgg.set(leave.user_id, { count: 1, minDate: leave.leave_date, maxDate: leave.leave_date });
        }
      }

      // Fetch profiles for user names
      const userIds = [...userAgg.keys()];
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

      // Build summaries
      const users: CPEmployeeSummary[] = [];
      let totalCpDays = 0;

      for (const [userId, agg] of userAgg) {
        users.push({
          userId,
          fullName: profilesMap.get(userId) || "Inconnu",
          cpDaysCount: agg.count,
          firstDate: agg.minDate,
          lastDate: agg.maxDate,
        });
        totalCpDays += agg.count;
      }

      // Sort by name
      users.sort((a, b) => a.fullName.localeCompare(b.fullName));

      return { users, totalCpDays };
    },
    enabled: !!establishmentId && !!yearMonth,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  return {
    users: query.data?.users || [],
    totalCpDays: query.data?.totalCpDays || 0,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
