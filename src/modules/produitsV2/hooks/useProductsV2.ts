/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — useProductsV2 Hook (List)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MIGRATION supplier_id (2026-02-09)
 * - Filtrage par supplier_id (SSOT) — pas par supplier_name
 * - suppliers = SupplierInfo[] avec id + name
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { fetchProductsV2List, fetchDistinctSuppliers } from "../services/productsV2Service";
import { normalizeSearch } from "@/utils/normalizeSearch";
import type { ProductV2Filters, SupplierInfo } from "../types";
import { useMemo, useState } from "react";

export function useProductsV2() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  // Filters state — supplier is now a UUID (supplier_id)
  const [filters, setFilters] = useState<ProductV2Filters>({
    search: "",
    category: null,
    categoryId: null,
    supplier: null,
    storageZone: null,
  });

  // Fetch products list
  const {
    data: products = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["products-v2", establishmentId],
    queryFn: () => fetchProductsV2List(establishmentId!),
    enabled: !!establishmentId,
    staleTime: 30_000, // 30 seconds
  });

  // Fetch distinct suppliers for filter dropdown (SupplierInfo[] with id + name)
  const { data: suppliers = [] } = useQuery<SupplierInfo[]>({
    queryKey: ["products-v2-suppliers", establishmentId],
    queryFn: () => fetchDistinctSuppliers(establishmentId!),
    enabled: !!establishmentId,
    staleTime: 60_000,
  });

  // Filter products locally for instant search
  const filteredProducts = useMemo(() => {
    let result = products;

    // Search filter
    if (filters.search.trim()) {
      const q = normalizeSearch(filters.search);
      result = result.filter(
        (p) =>
          normalizeSearch(p.nom_produit).includes(q) ||
          (p.code_produit ? normalizeSearch(p.code_produit).includes(q) : false) ||
          (p.code_barres ? normalizeSearch(p.code_barres).includes(q) : false)
      );
    }

    // Category filter — SSOT: use category_id only
    if (filters.categoryId) {
      result = result.filter((p) => p.category_id === filters.categoryId);
    }

    // Supplier filter — by supplier_id (SSOT)
    if (filters.supplier) {
      result = result.filter((p) => p.supplier_id === filters.supplier);
    }

    // Storage zone filter — by storage_zone_id (SSOT)
    if (filters.storageZone) {
      if (filters.storageZone === "__no_zone__") {
        // P0-5: Special value for "no zone assigned"
        result = result.filter((p) => !p.storage_zone_id);
      } else {
        result = result.filter((p) => p.storage_zone_id === filters.storageZone);
      }
    }

    return result;
  }, [products, filters]);

  return {
    products: filteredProducts,
    allProducts: products,
    isLoading,
    error,
    refetch,
    filters,
    setFilters,
    // suppliers now returns SupplierInfo[] (id + name)
    suppliers,
    totalCount: products.length,
    filteredCount: filteredProducts.length,
  };
}
