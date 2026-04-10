/**
 * DLC V0 — React Query hook to fetch DLC data for a commande's lines.
 */

import { useQuery } from "@tanstack/react-query";
import { getDlcForCommande } from "../services/dlcService";
import type { ReceptionLotDlc } from "../types";

/**
 * Fetches DLC records for given commande line IDs.
 * Returns a map of commande_line_id → ReceptionLotDlc for easy lookup.
 */
export function useDlcForCommande(commandeLineIds: string[] | null) {
  const enabled = !!commandeLineIds && commandeLineIds.length > 0;

  const query = useQuery({
    queryKey: ["dlc", "commande-lines", commandeLineIds],
    queryFn: () => getDlcForCommande(commandeLineIds!),
    enabled,
    staleTime: 30_000,
  });

  const dlcMap = new Map<string, ReceptionLotDlc>();
  if (query.data) {
    for (const dlc of query.data) {
      dlcMap.set(dlc.commande_line_id, dlc);
    }
  }

  return {
    dlcMap,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
