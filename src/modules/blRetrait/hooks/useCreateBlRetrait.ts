/**
 * Hook: create BL Retrait document after withdrawal POST
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBlRetraitDocument } from "../services/blRetraitService";
import type { CreateBlRetraitPayload } from "../types";

export function useCreateBlRetrait() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateBlRetraitPayload) => createBlRetraitDocument(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bl-retrait-documents"] });
    },
  });
}
