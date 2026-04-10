/**
 * DLC V1 — Hook to resolve effective DLC warning days for a set of products.
 *
 * SSOT: Uses resolveDlcWarningDays() from dlcCompute.ts with all 4 levels:
 * Product > Category > Establishment > Fallback
 *
 * This hook fetches the required data and provides a resolver function.
 * Used by: useDlcCritique, useDlcIssuesDetection, DlcBadge.
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { resolveDlcWarningDays } from "../lib/dlcCompute";
import { useDlcAlertSettings } from "./useDlcAlertSettings";

interface ProductDlcInfo {
  dlcWarningDays: number | null;
  categoryId: string | null;
}

/**
 * Provides a `resolveForProduct` function that returns the effective
 * warning days for any product, using the full priority chain.
 */
export function useDlcThresholdResolver(productIds: string[]) {
  const { defaultWarningDays, categoryThresholds } = useDlcAlertSettings();
  const [productInfoMap, setProductInfoMap] = useState<Record<string, ProductDlcInfo>>({});

  // Fetch product-level warning days + category from products_v2
  useEffect(() => {
    if (productIds.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("products_v2")
      .select("id, dlc_warning_days, category_id")
      .in("id", productIds)
      .then(({ data }: { data: { id: string; dlc_warning_days: number | null; category_id: string | null }[] | null }) => {
        if (!data) return;
        const map: Record<string, ProductDlcInfo> = {};
        for (const p of data) {
          map[p.id] = {
            dlcWarningDays: p.dlc_warning_days,
            categoryId: p.category_id,
          };
        }
        setProductInfoMap(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds.join(",")]);

  /**
   * Resolve the effective warning days for a specific product.
   * Uses the full priority chain: Product > Category > Establishment > Fallback
   */
  const resolveForProduct = useCallback(
    (productId: string): number => {
      const info = productInfoMap[productId];
      return resolveDlcWarningDays({
        productWarningDays: info?.dlcWarningDays,
        categoryId: info?.categoryId,
        categoryThresholds,
        establishmentDefaultDays: defaultWarningDays,
      });
    },
    [productInfoMap, categoryThresholds, defaultWarningDays]
  );

  /**
   * Get a map of productId → resolved warning days for all fetched products
   */
  const resolvedMap: Record<string, number> = {};
  for (const pid of productIds) {
    resolvedMap[pid] = resolveForProduct(pid);
  }

  return {
    /** Resolve for a single product */
    resolveForProduct,
    /** Map of productId → resolved warning days */
    resolvedWarningDays: resolvedMap,
    /** Raw product info (for passing to components) */
    productInfoMap,
  };
}
