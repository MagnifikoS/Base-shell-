/**
 * Hook: fetch BL-APP documents for a given month + establishment
 * Optionally filter by supplier.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchBlAppDocumentsByMonth } from "../services/blAppService";

export function useBlAppDocumentsByMonth(
  establishmentId: string | null,
  yearMonth: string | null,
  supplierId?: string
) {
  return useQuery({
    queryKey: ["bl-app-documents", establishmentId, yearMonth, supplierId ?? "all"],
    queryFn: () => fetchBlAppDocumentsByMonth(establishmentId!, yearMonth!, supplierId),
    enabled: !!establishmentId && !!yearMonth,
  });
}
