/**
 * Hook to compute total monthly payroll cost for a given month.
 * Aggregates planning shifts × hourly rates across all days.
 * Admin-only (uses employee_details which requires admin RLS).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import {
  computeMonthlyHours,
  computeHourlyRate,
  computePlanningPayrollCost,
} from "@/lib/payroll/payroll.compute";

export interface UseMonthlyPayrollCostResult {
  costMonthEur: number;
  isLoading: boolean;
  isUnavailable: boolean;
}

export function useMonthlyPayrollCost(
  establishmentId: string | null,
  year: number,
  month: number
): UseMonthlyPayrollCostResult {
  const { isAdmin } = usePermissions();

  const query = useQuery({
    queryKey: ["payroll", "month-cost", establishmentId, year, month],
    queryFn: async (): Promise<{ cost: number; unavailable: boolean }> => {
      if (!establishmentId || !isAdmin) {
        return { cost: 0, unavailable: !isAdmin };
      }

      // Date range for the month
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Fetch all planning shifts for this month
      const { data: shifts, error: shiftError } = await supabase
        .from("planning_shifts")
        .select("user_id, net_minutes")
        .eq("establishment_id", establishmentId)
        .gte("shift_date", startDate)
        .lte("shift_date", endDate);

      if (shiftError) throw new Error(shiftError.message);
      if (!shifts || shifts.length === 0) return { cost: 0, unavailable: false };

      // Aggregate by user
      const netMinutesByUser = new Map<string, number>();
      for (const s of shifts) {
        netMinutesByUser.set(s.user_id, (netMinutesByUser.get(s.user_id) ?? 0) + (s.net_minutes ?? 0));
      }

      const userIds = [...netMinutesByUser.keys()];

      const { data: contracts, error: contractError } = await supabase
        .from("employee_details")
        .select("user_id, gross_salary, contract_hours")
        .in("user_id", userIds);

      if (contractError) throw new Error(contractError.message);

      const contractMap = new Map(
        (contracts ?? []).map((c) => [c.user_id, { gross_salary: c.gross_salary ?? 0, contract_hours: c.contract_hours ?? 0 }])
      );

      let totalCost = 0;
      for (const [userId, minutes] of netMinutesByUser) {
        const contract = contractMap.get(userId);
        if (!contract || contract.gross_salary <= 0 || contract.contract_hours <= 0) continue;
        const monthlyHours = computeMonthlyHours(contract.contract_hours);
        const hourlyRate = computeHourlyRate(contract.gross_salary, monthlyHours);
        totalCost += computePlanningPayrollCost(minutes, hourlyRate);
      }

      return { cost: totalCost, unavailable: false };
    },
    enabled: !!establishmentId && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  return {
    costMonthEur: query.data?.cost ?? 0,
    isLoading: query.isLoading,
    isUnavailable: query.data?.unavailable ?? !isAdmin,
  };
}
