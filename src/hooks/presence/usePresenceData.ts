/**
 * Hook for fetching presence data for TODAY (current service day)
 * This is a WRAPPER around usePresenceByDate - SINGLE SOURCE OF TRUTH
 * V5.0: Refactored to use usePresenceByDate as the canonical source
 */

import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePresenceByDate } from "./usePresenceByDate";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import type { PresenceEmployeeCard } from "@/lib/presence/presence.compute";

export interface UsePresenceDataResult {
  employees: PresenceEmployeeCard[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  today: string;
}

export function usePresenceData(params?: { establishmentId?: string }): UsePresenceDataResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = params?.establishmentId ?? activeEstablishment?.id;

  // Step 1: Resolve the current service day
  const { data: serviceDay, isLoading: isLoadingServiceDay } = useServiceDayToday(establishmentId);

  // Step 2: Use the unified hook with resolved service day
  const presenceResult = usePresenceByDate({
    establishmentId,
    dayDate: serviceDay || "",
    enabled: !!serviceDay,
  });

  return {
    employees: presenceResult.employees,
    isLoading: isLoadingServiceDay || presenceResult.isLoading,
    error: presenceResult.error,
    refetch: presenceResult.refetch,
    today: serviceDay || "",
  };
}
