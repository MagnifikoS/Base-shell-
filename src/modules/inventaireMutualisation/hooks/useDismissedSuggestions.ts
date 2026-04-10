/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Dismissed Suggestions Hook
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  fetchDismissedHashes,
  dismissSuggestion,
  computeSuggestionHash,
} from "../services/dismissedService";

const DISMISSED_KEY = "mutualisation-dismissed";

export function useDismissedSuggestions() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [DISMISSED_KEY, establishmentId],
    enabled: !!establishmentId,
    staleTime: 5 * 60_000,
    queryFn: () => fetchDismissedHashes(establishmentId!),
  });

  const mutation = useMutation({
    mutationFn: (productIds: string[]) =>
      dismissSuggestion({
        establishmentId: establishmentId!,
        productIds,
        userId: user?.id ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [DISMISSED_KEY, establishmentId] });
      qc.invalidateQueries({
        queryKey: ["mutualisation-suggestions", establishmentId],
      });
      toast.success("Suggestion ignorée définitivement");
    },
    onError: (err: Error) => {
      toast.error(`Erreur lors du rejet : ${err.message}`);
    },
  });

  return {
    dismissedHashes: query.data ?? new Set<string>(),
    isLoading: query.isLoading,
    dismiss: mutation.mutate,
    isDismissing: mutation.isPending,
    computeHash: computeSuggestionHash,
  };
}
