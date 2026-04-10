/**
 * DLC V1 — Hook to fetch which products require mandatory DLC entry at reception.
 *
 * ISOLATED from useDlcIssuesDetection by design:
 * - useDlcIssuesDetection → detects DLC date issues (expired/warning)
 * - useDlcRequiredProducts → behavioural flag: "must user enter DLC at validation?"
 *
 * Reads products_v2.dlc_required_at_reception for a set of product IDs.
 * Returns a Set<string> of product IDs where DLC entry is mandatory.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Given a list of product IDs, returns the subset that require
 * mandatory DLC entry at reception.
 */
export function useDlcRequiredProducts(productIds: string[]) {
  const [requiredIds, setRequiredIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const key = productIds.slice().sort().join(",");

  useEffect(() => {
    if (productIds.length === 0) {
      setRequiredIds(new Set());
      return;
    }

    setIsLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("products_v2")
      .select("id")
      .in("id", productIds)
      .eq("dlc_required_at_reception", true)
      .then(({ data }: { data: { id: string }[] | null }) => {
        const ids = new Set<string>();
        if (data) {
          for (const row of data) ids.add(row.id);
        }
        setRequiredIds(ids);
        setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    /** Set of product IDs that require mandatory DLC at reception */
    dlcRequiredProductIds: requiredIds,
    /** Whether the flag data is still loading */
    isLoadingDlcRequired: isLoading,
    /** Check if a specific product requires DLC at reception */
    isDlcRequired: (productId: string) => requiredIds.has(productId),
  };
}
