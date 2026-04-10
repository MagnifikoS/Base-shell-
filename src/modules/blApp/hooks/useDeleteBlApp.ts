/**
 * Hook: soft-delete (void) a BL-APP document.
 * @deprecated Prefer useVoidBlApp which accepts a voidReason parameter.
 * This hook is kept for backward compatibility and delegates to voidBlAppDocument.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteBlAppDocument } from "../services/blAppService";

export function useDeleteBlApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) => deleteBlAppDocument(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bl-app-documents"] });
      queryClient.invalidateQueries({ queryKey: ["bl-app-by-stock-doc"] });
    },
  });
}
