/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHATS BRAIN SUMMARY — Hook (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hook pour récupérer les données de synthèse THE BRAIN.
 * Utilise React Query avec cache standard.
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { fetchBrainSummary, fetchAvailableMonths } from "../services/achatsBrainSummaryService";

/**
 * Hook pour récupérer les mois disponibles
 */
export function useAvailableMonths() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["achatsBrainSummary", "availableMonths", establishmentId],
    queryFn: () => fetchAvailableMonths(establishmentId!),
    enabled: !!establishmentId,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — summary data rarely changes
  });
}

/**
 * Hook pour récupérer le résumé THE BRAIN pour un mois donné
 */
export function useBrainSummary(yearMonth: string) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["achatsBrainSummary", "summary", establishmentId, yearMonth],
    queryFn: () => fetchBrainSummary(establishmentId!, yearMonth),
    enabled: !!establishmentId && !!yearMonth,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — summary data rarely changes
  });
}
