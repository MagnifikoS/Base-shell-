/**
 * Hook: fetch BL-APP document by stock_document_id
 * Returns null if no BL-APP exists for this reception yet.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchBlAppByStockDocumentId } from "../services/blAppService";

export function useBlAppDocumentByStockDocumentId(stockDocumentId: string | null) {
  return useQuery({
    queryKey: ["bl-app-by-stock-doc", stockDocumentId],
    queryFn: () => fetchBlAppByStockDocumentId(stockDocumentId!),
    enabled: !!stockDocumentId,
  });
}
