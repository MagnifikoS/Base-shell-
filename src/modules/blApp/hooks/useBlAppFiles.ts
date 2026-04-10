/**
 * Hook: fetch BL-APP files for a given BL-APP document.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchBlAppFiles } from "../services/blAppService";

export function useBlAppFiles(blAppDocumentId: string | null) {
  return useQuery({
    queryKey: ["bl-app-files", blAppDocumentId],
    queryFn: () => fetchBlAppFiles(blAppDocumentId!),
    enabled: !!blAppDocumentId,
  });
}
