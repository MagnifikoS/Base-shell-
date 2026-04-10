/**
 * useLitiges — React Query hooks for the Litiges module
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  getLitigeForCommande,
  getLitigeWithLines,
  resolveLitige,
} from "../services/litigeService";

const QUERY_KEY = "litiges";

export function useLitigeForCommande(commandeId: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY, "for-commande", commandeId],
    queryFn: () => getLitigeForCommande(commandeId!),
    enabled: !!commandeId,
    staleTime: 30_000,
  });
}

export function useLitigeDetail(litigeId: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY, "detail", litigeId],
    queryFn: () => getLitigeWithLines(litigeId!),
    enabled: !!litigeId,
    staleTime: 30_000,
  });
}

export function useResolveLitige() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resolveLitige,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["commandes"] });
      queryClient.invalidateQueries({ queryKey: ["unified-commandes-products"] });
    },
  });
}
