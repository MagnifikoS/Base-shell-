/**
 * Hook — Inventory History List
 * Fetches all completed sessions + variance counts via the variance engine.
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { computeInventoryHistoryList } from "../engine/inventoryHistoryVarianceEngine";

export function useInventoryHistoryList() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;

  return useQuery({
    queryKey: ["inventory-history-list", estId],
    queryFn: () => computeInventoryHistoryList(estId!),
    enabled: !!estId,
    staleTime: 2 * 60 * 1000, // 2 min — history is slow-changing
  });
}
