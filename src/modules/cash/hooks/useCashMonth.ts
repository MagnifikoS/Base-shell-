/**
 * Hook for fetching all cash day reports for a given month
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfMonth, endOfMonth, format } from "date-fns";
import type { CashDayReport } from "../utils/types";

interface UseCashMonthParams {
  establishmentId: string | null;
  year: number;
  month: number; // 1-12
}

export function useCashMonth({ establishmentId, year, month }: UseCashMonthParams) {
  const startDate = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
  const endDate = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

  const queryKey = ["cash-month", establishmentId, year, month];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<CashDayReport[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("cash_day_reports")
        .select("*")
        .eq("establishment_id", establishmentId)
        .gte("day_date", startDate)
        .lte("day_date", endDate)
        .order("day_date", { ascending: true });

      if (error) {
        if (import.meta.env.DEV) console.error("Error fetching cash month:", error);
        throw error;
      }

      return (data ?? []) as CashDayReport[];
    },
    enabled: !!establishmentId,
  });

  // Create a map of day_date -> report for quick lookup
  const reportsByDate = new Map<string, CashDayReport>();
  query.data?.forEach((report) => {
    reportsByDate.set(report.day_date, report);
  });

  // Calculate month totals
  const monthTotal = query.data?.reduce((sum, r) => sum + (r.total_eur ?? 0), 0) ?? 0;
  const totalShortage = query.data?.reduce((sum, r) => sum + (r.shortage_eur ?? 0), 0) ?? 0;
  const totalMaintenance = query.data?.reduce((sum, r) => sum + (r.maintenance_eur ?? 0), 0) ?? 0;

  return {
    reports: query.data ?? [],
    reportsByDate,
    monthTotal,
    totalShortage,
    totalMaintenance,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    startDate,
    endDate,
  };
}
