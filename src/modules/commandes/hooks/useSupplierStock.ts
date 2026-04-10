/**
 * useSupplierStock — Fetches supplier stock availability for order creation
 * 100% isolated: only active when share_stock is ON for the partnership.
 * Read-only, never writes. Non-blocking on errors.
 */

import { useQuery } from "@tanstack/react-query";
import { getSupplierStock, type SupplierStockItem } from "@/modules/clientsB2B/services/shareStockService";

interface UseSupplierStockParams {
  supplierEstablishmentId: string | null;
  clientEstablishmentId: string | null;
  partnershipId: string | null;
}

export function useSupplierStock({
  supplierEstablishmentId,
  clientEstablishmentId,
  partnershipId,
}: UseSupplierStockParams) {
  const query = useQuery<SupplierStockItem[]>({
    queryKey: [
      "b2b-supplier-stock",
      supplierEstablishmentId,
      clientEstablishmentId,
      partnershipId,
    ],
    queryFn: () =>
      getSupplierStock(
        supplierEstablishmentId!,
        clientEstablishmentId!,
        partnershipId!
      ),
    enabled: !!supplierEstablishmentId && !!clientEstablishmentId && !!partnershipId,
    staleTime: 60_000,
    // (6) Non-blocking: never throw to UI
    retry: 1,
  });

  /** Get stock for a given client product ID. Returns null if unknown/error. */
  const getStockForProduct = (clientProductId: string): number | null => {
    if (!query.data) return null;
    const item = query.data.find((s) => s.client_product_id === clientProductId);
    return item?.estimated_stock ?? null;
  };

  /** Get supplier unit ID for a given client product ID */
  const getSupplierUnitForProduct = (clientProductId: string): string | null => {
    if (!query.data) return null;
    const item = query.data.find((s) => s.client_product_id === clientProductId);
    return item?.supplier_unit_id ?? null;
  };

  /** Get supplier unit label for a given client product ID */
  const getSupplierUnitLabelForProduct = (clientProductId: string): string | null => {
    if (!query.data) return null;
    const item = query.data.find((s) => s.client_product_id === clientProductId);
    return item?.supplier_unit_label ?? null;
  };

  /** Check if share_stock data is available (non-empty response) */
  const isShareStockActive = (query.data?.length ?? 0) > 0;

  return {
    stockItems: query.data ?? [],
    isShareStockActive,
    getStockForProduct,
    getSupplierUnitForProduct,
    getSupplierUnitLabelForProduct,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
