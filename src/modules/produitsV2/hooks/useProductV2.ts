/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — useProductV2 Hook (Single product detail)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { fetchProductV2ById } from "../services/productsV2Service";

export function useProductV2(productId: string | null) {
  const {
    data: product,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["product-v2", productId],
    queryFn: () => fetchProductV2ById(productId!),
    enabled: !!productId,
  });

  return {
    product,
    isLoading,
    error,
    refetch,
  };
}
