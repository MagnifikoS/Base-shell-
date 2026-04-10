/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useErpQuantityLabels — Batch-loads product unit contexts for ERP display
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Returns a `formatQty(productId, canonicalQty, unitId, fallbackLabel?)` function
 * that produces human-readable packaging breakdowns.
 *
 * TWO-PASS RESOLUTION:
 *   Pass 1 (CL side): Fetches products_v2 directly by product_id.
 *     Works when the viewer owns the product (client side).
 *   Pass 2 (FO side): For any product_id NOT resolved in Pass 1,
 *     maps via b2b_imported_products (strictly filtered by CL↔FO couple)
 *     → source_product_id → fetches FO's own product for packaging context.
 *
 * SECURITY RULES:
 *   - Pass 2 mapping is constrained to exact (establishment_id, source_establishment_id) pair
 *   - formatQty NEVER uses canonical_unit_id (CL UUID) to look up units in FO context
 *   - In Pass 2 mode, qty is treated as canonical (factorToTarget=1) directly
 *   - Unresolved products get explicit fallback + DEV log with reason
 *
 * Graceful fallback: if BFS context unavailable, returns raw qty + label.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUnitConversions } from "@/core/unitConversion";
import {
  resolveProductUnitContext,
  type ReachableUnit,
} from "@/core/unitConversion/resolveProductUnitContext";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import { formatErpQuantity } from "@/lib/units/formatErpQuantity";
import { trackFallbackUsed, trackSuspiciousQty, trackTranslationOk, isSuspiciousQty } from "@/modules/commandes/utils/b2bMonitor";

interface UseErpInput {
  /** Product IDs from commande_lines (always client's product IDs) */
  productIds: string[];
  /** Client establishment ID (for strict B2B mapping filter) */
  clientEstablishmentId?: string | null;
  /** Supplier establishment ID (for strict B2B mapping filter) */
  supplierEstablishmentId?: string | null;
}

/** Tracks which products were resolved via Pass 2 (FO's product, not CL's) */
type ResolutionSource = "direct" | "b2b_mapped";

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Build ReachableUnit[] from a product row + unit conversion context.
 */
function buildUnitsForProduct(
  product: {
    stock_handling_unit_id: string | null;
    final_unit_id: string | null;
    delivery_unit_id: string | null;
    supplier_billing_unit_id: string | null;
    conditionnement_config: unknown;
  },
  dbUnits: import("@/core/unitConversion/types").UnitWithFamily[],
  dbConversions: import("@/core/unitConversion/types").ConversionRule[],
): ReachableUnit[] {
  const ctx = resolveProductUnitContext(
    {
      stock_handling_unit_id: product.stock_handling_unit_id,
      final_unit_id: product.final_unit_id,
      delivery_unit_id: product.delivery_unit_id,
      supplier_billing_unit_id: product.supplier_billing_unit_id,
      conditionnement_config:
        product.conditionnement_config as unknown as ConditioningConfig | null,
    },
    dbUnits,
    dbConversions,
  );

  return ctx.allowedInventoryEntryUnits;
}

export function useErpQuantityLabels(input: UseErpInput | null) {
  const { conversions: dbConversions, units: dbUnits } = useUnitConversions();

  const productIds = input?.productIds ?? [];
  const clientEstId = input?.clientEstablishmentId ?? null;
  const supplierEstId = input?.supplierEstablishmentId ?? null;

  // Stable key: sort IDs for deterministic key
  const sortedKey = [...productIds].sort().join(",");
  // Include dbUnits length in key so query re-runs when units load late (mobile cold start)
  const unitsReady = dbUnits.length;

  const { data: contextData } = useQuery({
    queryKey: ["erp-qty-contexts", sortedKey, unitsReady],
    queryFn: async (): Promise<{
      units: Map<string, ReachableUnit[]>;
      sources: Map<string, ResolutionSource>;
      unitMappings: Map<string, Record<string, string>>;
    }> => {
      const units = new Map<string, ReachableUnit[]>();
      const sources = new Map<string, ResolutionSource>();
      const unitMappings = new Map<string, Record<string, string>>();
      if (productIds.length === 0) return { units, sources, unitMappings };

      // ── Pass 1: Try direct fetch (works for CL, RLS-blocked for FO) ──
      const { data: directProducts } = await supabase
        .from("products_v2")
        .select(
          "id, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config",
        )
        .in("id", productIds);

      if (directProducts) {
        for (const product of directProducts) {
          const u = buildUnitsForProduct(product, dbUnits, dbConversions);
          if (u.length > 0) {
            units.set(product.id, u);
            sources.set(product.id, "direct");
          }
        }
      }

      // ── Pass 2: For unresolved IDs, try B2B mapping (FO side) ──
      const unresolvedIds = productIds.filter((id) => !units.has(id));

      if (unresolvedIds.length > 0 && supplierEstId) {
        // Strictly constrained mapping query:
        // - local_product_id = CL's product (from commande_lines)
        // - source_establishment_id = FO (the supplier viewing the commande)
        // - establishment_id = CL (the client who created the commande)
        let mappingQuery = supabase
          .from("b2b_imported_products")
          .select("local_product_id, source_product_id, unit_mapping")
          .in("local_product_id", unresolvedIds)
          .eq("source_establishment_id", supplierEstId);

        // Add CL filter if available (belt + suspenders)
        if (clientEstId) {
          mappingQuery = mappingQuery.eq("establishment_id", clientEstId);
        }

        const { data: mappings } = await mappingQuery;

        if (mappings && mappings.length > 0) {
          // Store persisted unit mappings (keyed by client product ID)
          for (const m of mappings) {
            const rawMapping = m.unit_mapping as Record<string, string> | null;
            if (rawMapping && typeof rawMapping === "object") {
              unitMappings.set(m.local_product_id, rawMapping);
            }
          }

          const sourceIds = mappings.map((m) => m.source_product_id);

          // Fetch supplier's own products (FO can read its own products_v2)
          const { data: supplierProducts } = await supabase
            .from("products_v2")
            .select(
              "id, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config",
            )
            .in("id", sourceIds);

          if (supplierProducts) {
            const sourceMap = new Map(
              supplierProducts.map((p) => [p.id, p]),
            );

            for (const mapping of mappings) {
              const supplierProduct = sourceMap.get(mapping.source_product_id);
              if (!supplierProduct) continue;

              const u = buildUnitsForProduct(supplierProduct, dbUnits, dbConversions);
              if (u.length > 0) {
                // Key by the CLIENT's product_id (what commande_lines reference)
                units.set(mapping.local_product_id, u);
                sources.set(mapping.local_product_id, "b2b_mapped");
              }
            }
          }
        }

        // Explicit log for unresolved products
        if (import.meta.env.DEV) {
          const stillUnresolved = unresolvedIds.filter((id) => !units.has(id));
          for (const id of stillUnresolved) {
            console.warn(
              `[useErpQuantityLabels] NOT_B2B_MAPPED — product ${id} has no ` +
              `b2b_imported_products mapping for supplier=${supplierEstId}. ` +
              `Falling back to raw quantity display.`,
            );
          }
        }
      } else if (unresolvedIds.length > 0 && !supplierEstId) {
        // No supplier context provided — cannot attempt Pass 2
        if (import.meta.env.DEV) {
          console.warn(
            `[useErpQuantityLabels] MISSING_SUPPLIER_CONTEXT — ${unresolvedIds.length} ` +
            `product(s) unresolved but no supplierEstablishmentId provided. ` +
            `Pass 2 skipped. Falling back to raw quantity display.`,
          );
        }
      }

      return { units, sources, unitMappings };
    },
    enabled: productIds.length > 0 && dbUnits.length > 0,
    staleTime: 5 * 60_000,
  });

  /**
   * Format a quantity for display using ERP packaging breakdown.
   *
   * CRITICAL CROSS-ORG SAFETY:
   * - When source is "direct" (Pass 1 / CL side), unitId UUID matches options → safe to use
   * - When source is "b2b_mapped" (Pass 2 / FO side), unitId is CL's UUID which does NOT
   *   exist in FO's unit context → we SKIP the UUID lookup entirely and treat qty as
   *   canonical (factorToTarget=1). This is safe because commande_lines always stores
   *   quantities in the canonical unit.
   *
   * @param productId   - Client's product ID (from commande_lines)
   * @param qty         - The stored quantity (always in canonical unit)
   * @param unitId      - canonical_unit_id from commande_lines (CL's UUID — ignored in Pass 2)
   * @param fallbackLabel - Fallback unit label if BFS unavailable
   */
  const formatQty = (
    productId: string,
    qty: number,
    unitId: string | null,
    fallbackLabel?: string | null,
  ): string => {
    const options = contextData?.units.get(productId);

    if (!options || options.length === 0) {
      if (import.meta.env.DEV) {
        console.warn(
          `[formatQty] NO_CONTEXT — product=${productId}, using fallback="${fallbackLabel}"`,
        );
      }
      return fallbackLabel
        ? `${fmtNum(qty)} ${fallbackLabel}`
        : fmtNum(qty);
    }

    const source = contextData?.sources.get(productId) ?? "direct";

    let targetQty = qty;

    if (source === "direct" && unitId) {
      // Pass 1 (same org): UUID lookup is safe
      const storedUnit = options.find((o) => o.id === unitId);
      if (storedUnit && storedUnit.factorToTarget !== 1) {
        targetQty = Math.round(qty * storedUnit.factorToTarget * 10000) / 10000;
      }
    } else if (source === "b2b_mapped") {
      // Pass 2 (cross-org): qty is canonical in CLIENT space.
      // Must translate to SUPPLIER canonical.

      // ── Priority 1: UUID-based lookup via persisted mapping ──
      const mapping = contextData?.unitMappings.get(productId);
      if (mapping && unitId) {
        const supplierUnitId = mapping[unitId];
        if (supplierUnitId) {
          const matchingUnit = options.find((o) => o.id === supplierUnitId);
          if (matchingUnit) {
            targetQty = Math.round(qty * matchingUnit.factorToTarget * 10000) / 10000;
            // Monitor: UUID mapping success
            if (supplierEstId) trackTranslationOk(productId, supplierEstId);
          }
        }
      }

      // ── Priority 2: Text fallback (if UUID lookup didn't resolve) ──
      if (targetQty === qty && fallbackLabel) {
        const normalizedLabel = fallbackLabel.toLowerCase().trim();
        const matchingUnit =
          options.find((o) => o.name.toLowerCase().trim() === normalizedLabel) ??
          options.find((o) => o.abbreviation.toLowerCase().trim() === normalizedLabel);
          if (matchingUnit) {
            targetQty = Math.round(qty * matchingUnit.factorToTarget * 10000) / 10000;
            // Monitor: text fallback was used
            if (supplierEstId) {
              trackFallbackUsed({ productId, label: fallbackLabel, supplierOptionsCount: options.length, establishmentId: supplierEstId });
            }
          } else if (import.meta.env.DEV) {
          console.warn(
            `[formatQty] B2B_NO_UNIT_MATCH — product=${productId}, ` +
            `label="${fallbackLabel}" not found in supplier options: ` +
            `[${options.map((o) => o.name).join(", ")}]. Using raw qty.`,
          );
        }
      }
    }

    // Monitor: suspicious qty check (cross-org only)
    if (source === "b2b_mapped" && isSuspiciousQty(targetQty) && supplierEstId) {
      trackSuspiciousQty({ productId, qty: targetQty, factor: targetQty / (qty || 1), establishmentId: supplierEstId });
    }

    const erp = formatErpQuantity(targetQty, options);
    if (import.meta.env.DEV && !erp) {
      console.warn(
        `[formatQty] ENGINE_NULL — product=${productId}, qty=${targetQty}, ` +
        `options=${options.length}, source=${source}`,
      );
    }
    if (!erp) {
      // Use canonical unit name from context if available
      const canonical = options.find((o) => o.factorToTarget === 1);
      if (canonical) {
        return `${fmtNum(qty)} ${canonical.name}`;
      }
      return fallbackLabel
        ? `${fmtNum(qty)} ${fallbackLabel}`
        : fmtNum(qty);
    }

    return erp.label;
  };

  return { formatQty, isReady: !!contextData };
}
