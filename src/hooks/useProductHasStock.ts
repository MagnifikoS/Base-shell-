/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useProductHasStock — Check if a product has non-zero stock
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Used to lock stock_handling_unit_id mutation in the UI when stock > 0.
 *
 * PHASE 2C: Now delegates 100% to fetchSingleProductStock (StockEngine adapter).
 * No inline SQL calculation — all stock math lives in stockEngine.ts.
 * The boolean is derived from the same SSOT as useProductCurrentStock.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnits } from "@/hooks/useUnits";
import { fetchSingleProductStock } from "@/modules/stockLedger";

export function useProductHasStock(productId: string | null | undefined): {
  hasStock: boolean;
  isLoading: boolean;
} {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { units: dbUnits } = useUnits();

  const { data, isLoading } = useQuery({
    queryKey: ["product-has-stock", estId, productId],
    queryFn: async () => {
      if (!estId || !productId) return false;

      const outcome = await fetchSingleProductStock(estId, productId, dbUnits);

      if (!outcome.ok) return false;

      return outcome.data.estimated_quantity !== 0;
    },
    enabled: !!estId && !!productId && dbUnits.length > 0,
    staleTime: 15_000,
  });

  return {
    hasStock: data ?? false,
    isLoading,
  };
}
