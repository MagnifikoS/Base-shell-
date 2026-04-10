/**
 * Hook to compute daily payroll cost for a specific establishment and day.
 *
 * This is a "black box" indicator for the Cash module:
 * - For admins: uses direct local queries (faster, no round-trip)
 * - For non-admins: calls secure Edge Function (RBAC enforced server-side)
 * - Returns ONLY aggregated cost, no employee details
 *
 * @see memory/architecture/payroll-cost-derivation-strategy
 * @see memory/features/cash/daily-payroll-indicators
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import {
  computeMonthlyHours,
  computeHourlyRate,
  computePlanningPayrollCost,
} from "@/lib/payroll/payroll.compute";

export interface UseDailyPayrollCostResult {
  /** Total payroll cost for the day in € (aggregated) */
  costDayEur: number;
  /** Loading state */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Indicates if data is unavailable due to permissions (show "—" instead of 0) */
  isUnavailable: boolean;
}

/**
 * Compute daily payroll cost based on planning shifts.
 *
 * @param establishmentId - The establishment UUID
 * @param dayDate - The service day in YYYY-MM-DD format (from get_service_day_now)
 * @returns Aggregated cost only, no employee details exposed
 */
export function useDailyPayrollCost(
  establishmentId: string | null,
  dayDate: string | null
): UseDailyPayrollCostResult {
  const { isAdmin } = usePermissions();

  const query = useQuery({
    // QueryKey follows existing pattern for realtime invalidation
    queryKey: ["payroll", "day", establishmentId, dayDate, isAdmin ? "local" : "edge"],
    queryFn: async (): Promise<{ cost: number; unavailable: boolean }> => {
      if (!establishmentId || !dayDate) {
        return { cost: 0, unavailable: false };
      }

      // ─────────────────────────────────────────────────────────────────────
      // Admin path: Direct local queries (has RLS access to employee_details)
      // ─────────────────────────────────────────────────────────────────────
      if (isAdmin) {
        return computeLocalPayrollCost(establishmentId, dayDate);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Non-admin path: Call secure Edge Function
      // ─────────────────────────────────────────────────────────────────────
      return callPayrollEdgeFunction(establishmentId, dayDate);
    },
    enabled: !!establishmentId && !!dayDate,
    // Keep reasonably fresh for realtime updates
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
    // Retry logic for edge function calls
    retry: (failureCount, error) => {
      // Don't retry on 403 (forbidden) - user doesn't have access
      if (error instanceof Error && error.message.includes("403")) {
        return false;
      }
      return failureCount < 2;
    },
  });

  return {
    costDayEur: query.data?.cost ?? 0,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    isUnavailable: query.data?.unavailable ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Local computation (existing logic)
// ─────────────────────────────────────────────────────────────────────────────

async function computeLocalPayrollCost(
  establishmentId: string,
  dayDate: string
): Promise<{ cost: number; unavailable: boolean }> {
  // 1. Fetch planning shifts for this specific day
  const { data: shifts, error: shiftError } = await supabase
    .from("planning_shifts")
    .select("user_id, net_minutes")
    .eq("establishment_id", establishmentId)
    .eq("shift_date", dayDate);

  if (shiftError) {
    throw new Error(`planning_shifts: ${shiftError.message}`);
  }

  if (!shifts || shifts.length === 0) {
    return { cost: 0, unavailable: false }; // No shifts planned = no payroll cost
  }

  // Aggregate net_minutes by user
  const netMinutesByUser = new Map<string, number>();
  const userIds: string[] = [];

  for (const s of shifts) {
    const current = netMinutesByUser.get(s.user_id) || 0;
    netMinutesByUser.set(s.user_id, current + (s.net_minutes || 0));
    if (!userIds.includes(s.user_id)) {
      userIds.push(s.user_id);
    }
  }

  if (userIds.length === 0) {
    return { cost: 0, unavailable: false };
  }

  // 2. Fetch employee_details for hourly rate calculation
  const { data: contracts, error: contractError } = await supabase
    .from("employee_details")
    .select("user_id, gross_salary, contract_hours")
    .in("user_id", userIds);

  if (contractError) {
    throw new Error(`employee_details: ${contractError.message}`);
  }

  // Build contract map
  const contractMap = new Map(
    (contracts || []).map((c) => [
      c.user_id,
      {
        gross_salary: c.gross_salary ?? 0,
        contract_hours: c.contract_hours ?? 0,
      },
    ])
  );

  // 3. Compute total cost using Payroll engine
  let totalCost = 0;

  for (const [userId, userNetMinutes] of netMinutesByUser) {
    const contract = contractMap.get(userId);

    // Skip if no valid contract data
    if (!contract || contract.gross_salary <= 0 || contract.contract_hours <= 0) {
      continue;
    }

    // Use Payroll engine functions (single source of truth)
    const monthlyHours = computeMonthlyHours(contract.contract_hours);
    const hourlyRate = computeHourlyRate(contract.gross_salary, monthlyHours);
    const userCost = computePlanningPayrollCost(userNetMinutes, hourlyRate);

    totalCost += userCost;
  }

  return { cost: totalCost, unavailable: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-admin: Edge Function call
// ─────────────────────────────────────────────────────────────────────────────

async function callPayrollEdgeFunction(
  establishmentId: string,
  dayDate: string
): Promise<{ cost: number; unavailable: boolean }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    // No session = cannot call edge function
    return { cost: 0, unavailable: true };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const response = await fetch(`${supabaseUrl}/functions/v1/payroll-daily-cost`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      establishment_id: establishmentId,
      day_date: dayDate,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    // 403 = no permission, mark as unavailable (show "—")
    if (response.status === 403) {
      return { cost: 0, unavailable: true };
    }

    throw new Error(`${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return { cost: data.cost_day_eur ?? 0, unavailable: false };
}
