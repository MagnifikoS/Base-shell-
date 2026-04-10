/**
 * ═══════════════════════════════════════════════════════════════
 * useDiscrepancyInvestigation — Lazy-loaded investigation data
 * ═══════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { fetchInvestigation } from "../services/discrepancyService";
import type { DiscrepancyWithDetails } from "../types";

export function useDiscrepancyInvestigation(discrepancy: DiscrepancyWithDetails | null) {
  return useQuery({
    queryKey: ["discrepancy-investigation", discrepancy?.id],
    queryFn: () => {
      if (!discrepancy) throw new Error("No discrepancy");
      return fetchInvestigation(
        discrepancy.establishment_id,
        discrepancy.product_id,
        discrepancy.withdrawn_at
      );
    },
    enabled: !!discrepancy,
    staleTime: 60_000,
  });
}
