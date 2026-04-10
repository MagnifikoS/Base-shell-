/**
 * Hook: soft-delete (void) a BL-APP document.
 * Sets voided_at + void_reason instead of hard-deleting.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { voidBlAppDocument } from "../services/blAppService";

export function useVoidBlApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, voidReason }: { documentId: string; voidReason: string }) =>
      voidBlAppDocument(documentId, voidReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bl-app-documents"] });
      queryClient.invalidateQueries({ queryKey: ["bl-app-by-stock-doc"] });
    },
  });
}
