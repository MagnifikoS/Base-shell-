/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useProductCurrentStock — Lightweight per-product stock lookup
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Returns the current estimated stock for a single product.
 *
 * PHASE 2B: Now delegates 100% to fetchSingleProductStock (StockEngine adapter).
 * No inline SQL calculation — all stock math lives in stockEngine.ts.
 *
 * Used by: all callers of UniversalQuantityModal to display "Stock actuel".
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnits } from "@/hooks/useUnits";
import { fetchSingleProductStock } from "@/modules/stockLedger";

interface ProductStockResult {
  currentStockCanonical: number | null;
  currentStockUnitLabel: string | null;
  isLoading: boolean;
}

export function useProductCurrentStock(productId: string | null | undefined): ProductStockResult {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { units: dbUnits } = useUnits();

  const { data, isLoading } = useQuery({
    queryKey: ["product-current-stock", estId, productId],
    queryFn: async () => {
      if (!estId || !productId) return null;

      const outcome = await fetchSingleProductStock(estId, productId, dbUnits);

      if (!outcome.ok) return null;

      return {
        canonical: outcome.data.estimated_quantity,
        unitLabel: outcome.data.canonical_label,
      };
    },
    enabled: !!estId && !!productId && dbUnits.length > 0,
    staleTime: 15_000,
  });

  return {
    currentStockCanonical: data?.canonical ?? null,
    currentStockUnitLabel: data?.unitLabel ?? null,
    isLoading,
  };
}
