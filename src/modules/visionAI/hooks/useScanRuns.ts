/**
 * React Query hook for scan runs (extraction attempts for a given scan)
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchScanRuns } from "../services/scanHistoryService";
import type { ScanRun } from "../types/scanHistory";

export function useScanRuns(scanId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery<ScanRun[]>({
    queryKey: ["vision-ai-scan-runs", scanId],
    queryFn: () => fetchScanRuns(scanId!),
    enabled: !!scanId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    if (scanId) {
      queryClient.invalidateQueries({
        queryKey: ["vision-ai-scan-runs", scanId],
      });
    }
  };

  return {
    runs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    invalidate,
  };
}
