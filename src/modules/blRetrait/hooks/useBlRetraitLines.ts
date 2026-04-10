/**
 * Hook: fetch BL Retrait lines for a given document
 */

import { useQuery } from "@tanstack/react-query";
import { fetchBlRetraitLines } from "../services/blRetraitService";

export function useBlRetraitLines(documentId: string | null) {
  return useQuery({
    queryKey: ["bl-retrait-lines", documentId],
    queryFn: () => fetchBlRetraitLines(documentId!),
    enabled: !!documentId,
  });
}
