/**
 * Hook: complete BL-APP document (set bl_number, status=FINAL)
 * Called from the popup "Enregistrer" button.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { completeBlAppDocument } from "../services/blAppService";
import type { CompleteBlAppPayload } from "../types";

export function useCompleteBlApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      payload,
    }: {
      documentId: string;
      payload: CompleteBlAppPayload;
    }) => completeBlAppDocument(documentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bl-app-documents"] });
      queryClient.invalidateQueries({ queryKey: ["bl-app-by-stock-doc"] });
    },
  });
}
