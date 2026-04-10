/**
 * ═══════════════════════════════════════════════════════════════
 * useCreateDiscrepancy — Fire-and-forget discrepancy creation
 * ═══════════════════════════════════════════════════════════════
 * Called after a successful withdrawal to detect gaps.
 * NEVER blocks the withdrawal.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createDiscrepancy } from "../services/discrepancyService";
import type { CreateDiscrepancyParams } from "../types";

export function useCreateDiscrepancy() {
  const queryClient = useQueryClient();

  const detect = useCallback(
    async (params: CreateDiscrepancyParams) => {
      const gap = params.withdrawalQuantity - Math.max(0, params.estimatedStockBefore);
      if (gap <= 0) return; // No discrepancy

      await createDiscrepancy({
        ...params,
        gapQuantity: gap,
      });

      // Refresh discrepancies list
      queryClient.invalidateQueries({ queryKey: ["inventory-discrepancies"] });
    },
    [queryClient]
  );

  return { detect };
}
