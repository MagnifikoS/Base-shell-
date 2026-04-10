/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useAutoInitializeErrorProducts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Automatically initializes products that have alert_level === "error"
 * (non-calculable) by calling fn_initialize_product_stock for each.
 * After all initializations complete, triggers a refetch of alerts.
 */

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { StockAlertItem } from "./useStockAlerts";

interface UseAutoInitializeErrorProductsOptions {
  alerts: StockAlertItem[] | undefined;
  isLoading: boolean;
  refetch: () => void;
}

export function useAutoInitializeErrorProducts({
  alerts,
  isLoading,
  refetch,
}: UseAutoInitializeErrorProductsOptions) {
  const { user } = useAuth();
  /** Track which product IDs we've already attempted to avoid loops */
  const attemptedRef = useRef<Set<string>>(new Set());
  const isRunningRef = useRef(false);

  const runAutoInit = useCallback(async () => {
    if (!alerts || isLoading || !user?.id || isRunningRef.current) return;

    const errorProducts = alerts.filter(
      (a) =>
        a.alert_level === "error" &&
        a.product_id &&
        !attemptedRef.current.has(a.product_id)
    );

    if (errorProducts.length === 0) return;

    isRunningRef.current = true;

    // Deduplicate by product_id
    const uniqueIds = [...new Set(errorProducts.map((a) => a.product_id))];

    // Mark as attempted immediately to prevent re-runs
    for (const id of uniqueIds) {
      attemptedRef.current.add(id);
    }

    // Initialize all in parallel (batches of 5 to avoid overload)
    const batchSize = 5;
    let anySuccess = false;

    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      const batch = uniqueIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((productId) =>
          supabase.rpc("fn_initialize_product_stock", {
            p_product_id: productId,
            p_user_id: user.id,
          })
        )
      );

      for (const r of results) {
        if (r.status === "fulfilled" && !r.value.error) {
          const data = r.value.data as Record<string, unknown> | null;
          if (data?.ok) anySuccess = true;
        }
      }
    }

    isRunningRef.current = false;

    if (anySuccess) {
      // Small delay to let DB settle, then refetch
      setTimeout(() => refetch(), 300);
    }
  }, [alerts, isLoading, user?.id, refetch]);

  useEffect(() => {
    runAutoInit();
  }, [runAutoInit]);
}
