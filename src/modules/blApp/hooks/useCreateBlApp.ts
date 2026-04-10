/**
 * Hook: create BL-APP document + lines after POST OK (idempotent).
 * Called by Étape 2 in the post-reception workflow.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBlAppDocument } from "../services/blAppService";
import type { CreateBlAppPayload } from "../types";

export function useCreateBlApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateBlAppPayload) => createBlAppDocument(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["bl-app-by-stock-doc", variables.stock_document_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["bl-app-documents"],
      });
    },
  });
}
