/**
 * React Query hook for scan history list
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { fetchScans } from "../services/scanHistoryService";
import type { ScanDocument } from "../types/scanHistory";

export function useScanHistory() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();

  const query = useQuery<ScanDocument[]>({
    queryKey: ["vision-ai-scans", activeEstablishment?.id],
    queryFn: () => fetchScans(activeEstablishment!.id),
    enabled: !!activeEstablishment?.id,
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ["vision-ai-scans", activeEstablishment?.id],
    });
  };

  return {
    scans: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    invalidate,
  };
}
