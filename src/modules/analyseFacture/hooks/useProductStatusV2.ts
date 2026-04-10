/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HOOK: useProductStatusV2
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fetches V2 products and determines status (🟢/🟠) for extracted lines.
 *
 * RESPONSIBILITIES:
 * - Fetch products_v2 for current establishment
 * - Compute status for each extracted item
 *
 * NOTE: Price comparison and update functionality has been removed.
 */

import { useMemo, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import type { ExtractedProductLine } from "@/modules/shared";
import type { ProductV2 } from "@/modules/produitsV2";
import {
  determineAllLineStatuses,
  countByStatus,
  type LineStatusResult,
  type ConfirmedMatch,
} from "../engine/productLineStatusV2";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Re-export for use in components
export type { ConfirmedMatch };

export interface UseProductStatusV2Options {
  items: ExtractedProductLine[];
  enabled?: boolean;
  /** Matches confirmés par l'utilisateur (fuzzy → exact) */
  confirmedMatches?: Record<string, ConfirmedMatch>;
}

export interface UseProductStatusV2Result {
  /** Status for each item (by index) */
  statuses: Map<number, LineStatusResult>;

  /** Can all items be validated? (all green or resolved) */
  canValidateAll: boolean;

  /** Counts by status */
  counts: {
    validated: number;
    priceAlert: number;
    needsAction: number;
    total: number;
  };

  /** Is loading V2 products? */
  isLoading: boolean;

  /** Mark an item as resolved */
  resolveItem: (index: number) => void;

  /** Update V2 product price — REMOVED (no-op kept for interface compat) */
  updateProductPrice: (productId: string, newPrice: number) => Promise<void>;

  /** Resolved items (indices that user has already decided) */
  resolvedItems: Set<number>;

  /** Refetch V2 products */
  refetch: () => void;

  /** V2 products list (for Phase 1 suggestions) */
  productsV2: ProductV2[];
}

// Transform DB row to ProductV2 (since conditionnement_config is JSON)
function transformRowToProductV2(row: Record<string, unknown>): ProductV2 {
  return {
    id: row.id as string,
    establishment_id: row.establishment_id as string,
    code_produit: row.code_produit as string | null,
    code_barres: row.code_barres as string | null,
    nom_produit: row.nom_produit as string,
    nom_produit_fr: row.nom_produit_fr as string | null,
    name_normalized: row.name_normalized as string,
    variant_format: row.variant_format as string | null,
    category: row.category as string | null,
    category_id: row.category_id as string | null,
    supplier_id: row.supplier_id as string,
    supplier_billing_unit_id: row.supplier_billing_unit_id as string | null,
    storage_zone_id: row.storage_zone_id as string | null,
    conditionnement_config: row.conditionnement_config
      ? typeof row.conditionnement_config === "string"
        ? JSON.parse(row.conditionnement_config)
        : row.conditionnement_config
      : null,
    conditionnement_resume: row.conditionnement_resume as string | null,
    final_unit_price: row.final_unit_price as number | null,
    final_unit_id: row.final_unit_id as string | null,
    stock_handling_unit_id: row.stock_handling_unit_id as string | null,
    kitchen_unit_id: row.kitchen_unit_id as string | null,
    delivery_unit_id: row.delivery_unit_id as string | null,
    price_display_unit_id: row.price_display_unit_id as string | null,
    min_stock_quantity_canonical: row.min_stock_quantity_canonical as number | null,
    min_stock_unit_id: row.min_stock_unit_id as string | null,
    min_stock_updated_at: row.min_stock_updated_at as string | null,
    min_stock_updated_by: row.min_stock_updated_by as string | null,
    info_produit: row.info_produit as string | null,
    dlc_warning_days: (row.dlc_warning_days as number | null) ?? null,
    supplier_billing_quantity: (row.supplier_billing_quantity as number | null) ?? null,
    supplier_billing_line_total: (row.supplier_billing_line_total as number | null) ?? null,
    allow_unit_sale: row.allow_unit_sale === true,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    archived_at: row.archived_at as string | null,
    created_by: row.created_by as string | null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

export function useProductStatusV2({
  items,
  enabled = true,
  confirmedMatches = {},
}: UseProductStatusV2Options): UseProductStatusV2Result {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;
  const _queryClient = useQueryClient();

  // Track resolved items (user has made a decision)
  const [resolvedItemsSet, setResolvedItemsSet] = useState<Set<number>>(() => new Set());

  // Fetch all V2 products
  const {
    data: productsV2 = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["products-v2-for-status", establishmentId],
    queryFn: async (): Promise<ProductV2[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("products_v2")
        .select(
          "id, establishment_id, code_produit, code_barres, nom_produit, nom_produit_fr, name_normalized, variant_format, category, supplier_id, supplier_billing_unit_id, storage_zone_id, conditionnement_config, conditionnement_resume, final_unit_price, final_unit_id, stock_handling_unit_id, kitchen_unit_id, delivery_unit_id, price_display_unit_id, min_stock_quantity_canonical, min_stock_unit_id, min_stock_updated_at, min_stock_updated_by, info_produit, created_at, updated_at, archived_at, created_by"
        )
        .eq("establishment_id", establishmentId)
        .is("archived_at", null);

      if (error) throw error;

      return (data ?? []).map((row) => transformRowToProductV2(row as Record<string, unknown>));
    },
    enabled: !!establishmentId && enabled && items.length > 0,
  });

  // Compute statuses for all items
  const statuses = useMemo(() => {
    if (items.length === 0 || productsV2.length === 0) {
      return new Map<number, LineStatusResult>();
    }
    return determineAllLineStatuses(items, productsV2, confirmedMatches);
  }, [items, productsV2, confirmedMatches]);

  // Adjust canValidateAll to account for resolved items
  const canValidateAllResult = useMemo(() => {
    if (statuses.size === 0) return items.length === 0;

    for (const [index, status] of statuses) {
      if (status.requiresDecision && !resolvedItemsSet.has(index)) {
        return false;
      }
    }
    return true;
  }, [statuses, resolvedItemsSet, items.length]);

  // Counts
  const counts = useMemo(() => {
    if (statuses.size === 0) {
      return { validated: 0, priceAlert: 0, needsAction: 0, total: items.length };
    }
    return countByStatus(statuses);
  }, [statuses, items.length]);

  // Mark item as resolved
  const resolveItem = useCallback((index: number) => {
    setResolvedItemsSet((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  // updateProductPrice — REMOVED (no-op for interface compatibility)
  const updateProductPrice = useCallback(async (_productId: string, _newPrice: number) => {
    // Price comparison removed — no-op
  }, []);

  return {
    statuses,
    canValidateAll: canValidateAllResult,
    counts,
    isLoading,
    resolveItem,
    updateProductPrice,
    resolvedItems: resolvedItemsSet,
    refetch,
    productsV2,
  };
}
