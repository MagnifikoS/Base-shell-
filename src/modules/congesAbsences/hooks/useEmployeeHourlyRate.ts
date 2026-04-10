/**
 * Hook to fetch current employee's hourly rate for payroll estimation
 *
 * Uses SSOT formula: hourlyRateOperational = total_salary / monthlyHours
 * where monthlyHours = contract_hours × WEEKS_PER_MONTH
 *
 * This is UI-only estimation - no backend calculation
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  computeMonthlyHours,
  computeHourlyRateOperational,
  DAILY_WORK_MINUTES,
} from "@/lib/payroll/payroll.compute";

export interface EmployeePayrollEstimation {
  /** Hourly rate operational (€/h) */
  hourlyRate: number;
  /** Can calculate estimation (all data available) */
  canEstimate: boolean;
  /** Daily deduction in € (7h × hourlyRate) */
  dailyDeduction: number;
}

/**
 * Fetch employee's payroll estimation data (hourly rate)
 * Uses total_salary / monthlyHours formula (SSOT)
 */
export function useEmployeeHourlyRate(): {
  data: EmployeePayrollEstimation;
  isLoading: boolean;
} {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["employee-hourly-rate", establishmentId],
    queryFn: async (): Promise<EmployeePayrollEstimation> => {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return { hourlyRate: 0, canEstimate: false, dailyDeduction: 0 };
      }

      // Fetch employee details
      const { data: details, error } = await supabase
        .from("employee_details")
        .select("total_salary, contract_hours")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !details) {
        return { hourlyRate: 0, canEstimate: false, dailyDeduction: 0 };
      }

      const totalSalary = details.total_salary ?? 0;
      const contractHours = details.contract_hours ?? 0;

      // Check if we have valid data
      if (totalSalary <= 0 || contractHours <= 0) {
        return { hourlyRate: 0, canEstimate: false, dailyDeduction: 0 };
      }

      // Calculate hourly rate using payroll engine formula (SSOT)
      const monthlyHours = computeMonthlyHours(contractHours);
      const hourlyRate = computeHourlyRateOperational(totalSalary, monthlyHours);

      // Daily deduction = 7h × hourlyRate (DAILY_WORK_MINUTES = 420 min = 7h)
      const dailyDeduction = (DAILY_WORK_MINUTES / 60) * hourlyRate;

      return {
        hourlyRate,
        canEstimate: true,
        dailyDeduction,
      };
    },
    enabled: !!establishmentId,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — hourly rate rarely changes
    retry: false,
  });

  return {
    data: query.data ?? { hourlyRate: 0, canEstimate: false, dailyDeduction: 0 },
    isLoading: query.isLoading,
  };
}
