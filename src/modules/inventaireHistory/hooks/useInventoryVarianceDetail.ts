/**
 * Hook — Inventory Variance Detail (multi-session group)
 * Computes variance lines for all sessions in an InventoryEventGroup.
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { computeInventoryVarianceGroup } from "../engine/inventoryHistoryVarianceEngine";

export function useInventoryVarianceDetail(sessionIds: string[] | null) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;
  const key = sessionIds?.join(",") ?? null;

  return useQuery({
    queryKey: ["inventory-variance-group", key, estId],
    queryFn: () => computeInventoryVarianceGroup(sessionIds!, estId!),
    enabled: !!sessionIds && sessionIds.length > 0 && !!estId,
    staleTime: 5 * 60 * 1000,
  });
}
