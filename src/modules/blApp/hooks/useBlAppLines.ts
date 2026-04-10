/**
 * Hook: fetch BL-APP lines for a given BL-APP document.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchBlAppLines } from "../services/blAppService";

export function useBlAppLines(blAppDocumentId: string | null) {
  return useQuery({
    queryKey: ["bl-app-lines", blAppDocumentId],
    queryFn: () => fetchBlAppLines(blAppDocumentId!),
    enabled: !!blAppDocumentId,
  });
}
