/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — usePurchases Hook (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Hook React Query pour récupérer le récap mensuel des achats.
 * Lecture seule — aucun calcul métier.
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { fetchMonthlyPurchaseSummary } from "../services/purchaseService";
import type { MonthlyPurchaseSummary } from "../types";

interface UsePurchasesOptions {
  yearMonth: string;
  enabled?: boolean;
}

export function usePurchases({ yearMonth, enabled = true }: UsePurchasesOptions) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  const query = useQuery<MonthlyPurchaseSummary[], Error>({
    queryKey: ["purchases", establishmentId, yearMonth],
    queryFn: async () => {
      if (!establishmentId) {
        return [];
      }
      return fetchMonthlyPurchaseSummary(establishmentId, yearMonth);
    },
    enabled: enabled && !!establishmentId && !!yearMonth,
    staleTime: 30_000, // 30s cache
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
