/**
 * Shared hook for saving min stock — SSOT: products_v2 only.
 * Used by both product detail page and inventory desktop table.
 *
 * PHASE 1 FIX: All writes go through updateProductV2() — no direct .update().
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateProductV2 } from "../services/productsV2Service";
import { toast } from "sonner";

interface SaveMinStockParams {
  productId: string;
  canonicalQty: number | null;
  canonicalUnitId: string | null;
}

export function useMinStockSave() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ productId, canonicalQty, canonicalUnitId }: SaveMinStockParams) => {
      await updateProductV2(productId, {
        min_stock_quantity_canonical: canonicalQty,
        min_stock_unit_id: canonicalUnitId,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["product-v2", variables.productId] });
      queryClient.invalidateQueries({ queryKey: ["product-v2"] });
      queryClient.invalidateQueries({ queryKey: ["products-v2"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
    },
  });

  const saveMinStock = async (
    productId: string,
    qty: number,
    factorToTarget: number,
    canonicalUnitId: string | null
  ) => {
    const canonicalQty = qty === 0 ? null : Math.round(qty * factorToTarget * 10000) / 10000;
    const unitId = canonicalQty === null ? null : canonicalUnitId;

    await mutation.mutateAsync({ productId, canonicalQty, canonicalUnitId: unitId });
    toast.success(canonicalQty === null ? "Stock minimum supprimé." : "Stock minimum enregistré.");
  };

  const clearMinStock = async (productId: string) => {
    await mutation.mutateAsync({ productId, canonicalQty: null, canonicalUnitId: null });
    toast.success("Stock minimum supprimé.");
  };

  return { saveMinStock, clearMinStock, isSaving: mutation.isPending };
}
