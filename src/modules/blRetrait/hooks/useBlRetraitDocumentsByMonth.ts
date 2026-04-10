/**
 * Hook: fetch BL Retrait documents for a given month + establishment
 */

import { useQuery } from "@tanstack/react-query";
import { fetchBlRetraitDocumentsByMonth } from "../services/blRetraitService";

export function useBlRetraitDocumentsByMonth(
  establishmentId: string | null,
  yearMonth: string | null
) {
  return useQuery({
    queryKey: ["bl-retrait-documents", establishmentId, yearMonth],
    queryFn: () => fetchBlRetraitDocumentsByMonth(establishmentId!, yearMonth!),
    enabled: !!establishmentId && !!yearMonth,
  });
}
