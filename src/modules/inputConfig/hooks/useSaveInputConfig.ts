/**
 * Mutation hook for upserting product input configs (single or bulk).
 *
 * ARCHITECTURE: Saves mode + preferred_unit_id (suggestion) + unit_chain (multi-level).
 * - unit_chain: ordered unit array for multi_level mode (null otherwise)
 * - preferred_unit_id = unit_chain[0] for backward compatibility
 * No level_* booleans — the engine decides which levels to show.
 *
 * PURCHASE CONFIG:
 * purchase_* is NEVER derived from reception_*. It is either:
 * 1. Explicitly provided by the caller (via buildPurchaseConfig)
 * 2. Computed here from the product's physical structure (packaging + final_unit)
 * 3. Set to safe defaults for mode-only bulk saves (null unit, no chain)
 *
 * PRE-PERSIST VALIDATION:
 * When validationContext is provided, each product's candidate config is validated
 * against the central resolver (resolveInputUnitForContext) for ALL 3 contexts.
 * If any context returns a non-"ok" status, the save is rejected.
 * Skipped for mode-only bulk saves (no validationContext).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { InputMode, ProductInputConfigRow } from "../types";
import { resolveInputUnitForContext } from "../utils/resolveInputUnitForContext";
import type { ProductForResolution } from "../utils/resolveInputUnitForContext";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import { buildPurchaseConfig } from "../utils/buildPurchaseConfig";

interface SavePayload {
  productIds: string[];
  reception_mode: InputMode;
  reception_preferred_unit_id: string | null;
  reception_unit_chain: string[] | null;
  internal_mode: InputMode;
  internal_preferred_unit_id: string | null;
  internal_unit_chain: string[] | null;
  /**
   * Purchase config — optional. When provided, used as-is.
   * When omitted AND validationContext is provided, computed via buildPurchaseConfig
   * from the product's physical structure (packaging levels + final_unit).
   * When omitted AND no validationContext (bulk mode-only), defaults to safe values.
   *
   * NEVER derived from reception_*. purchase_* is independent.
   */
  purchase_mode?: InputMode;
  purchase_preferred_unit_id?: string | null;
  purchase_unit_chain?: string[] | null;
  /**
   * Optional validation context — when provided, the resolver validates
   * each product's candidate config before persisting.
   * Omit for mode-only bulk saves where unit IDs are intentionally null.
   */
  validationContext?: {
    products: ProductForResolution[];
    dbUnits: UnitWithFamily[];
    dbConversions: ConversionRule[];
  };
}

/**
 * Extract packaging levels from a product's conditionnement_config for buildPurchaseConfig.
 */
function extractPackagingLevels(
  conditionnementConfig: unknown,
): Array<{ type_unit_id?: string | null }> {
  if (!conditionnementConfig || typeof conditionnementConfig !== "object") return [];
  const config = conditionnementConfig as Record<string, unknown>;
  const levels = config.packagingLevels;
  if (!Array.isArray(levels)) return [];
  return levels.map((l: unknown) => {
    if (!l || typeof l !== "object") return {};
    const level = l as Record<string, unknown>;
    return { type_unit_id: (level.type_unit_id as string) ?? null };
  });
}

/**
 * Compute purchase config for a single product.
 * Uses buildPurchaseConfig (L0, independent of toggle) — NEVER copies reception_*.
 */
function computePurchaseForProduct(
  product: ProductForResolution,
  dbUnits: Array<{ id: string; family: string | null }>,
  explicitPayload: Pick<SavePayload, "purchase_mode" | "purchase_preferred_unit_id" | "purchase_unit_chain">,
): { purchase_mode: InputMode; purchase_preferred_unit_id: string | null; purchase_unit_chain: string[] | null } {
  // If caller explicitly provided purchase_*, use it
  if (explicitPayload.purchase_mode !== undefined) {
    return {
      purchase_mode: explicitPayload.purchase_mode,
      purchase_preferred_unit_id: explicitPayload.purchase_preferred_unit_id ?? null,
      purchase_unit_chain: explicitPayload.purchase_unit_chain ?? null,
    };
  }

  // Compute from product's physical structure via buildPurchaseConfig
  const packagingLevels = extractPackagingLevels(product.conditionnement_config);
  const result = buildPurchaseConfig(packagingLevels, product.final_unit_id, dbUnits);
  return {
    purchase_mode: result.purchase_mode,
    purchase_preferred_unit_id: result.purchase_preferred_unit_id,
    purchase_unit_chain: null,
  };
}

/**
 * Build a synthetic ProductInputConfigRow from the save payload
 * for resolver validation. Only the fields the resolver reads are set.
 */
function buildSyntheticConfig(
  productId: string,
  establishmentId: string,
  payload: SavePayload,
  purchaseConfig: { purchase_mode: InputMode; purchase_preferred_unit_id: string | null; purchase_unit_chain: string[] | null },
): ProductInputConfigRow {
  return {
    id: "",
    product_id: productId,
    establishment_id: establishmentId,
    reception_mode: payload.reception_mode,
    reception_preferred_unit_id: payload.reception_preferred_unit_id,
    reception_unit_chain: payload.reception_unit_chain,
    internal_mode: payload.internal_mode,
    internal_preferred_unit_id: payload.internal_preferred_unit_id,
    internal_unit_chain: payload.internal_unit_chain,
    purchase_mode: purchaseConfig.purchase_mode,
    purchase_preferred_unit_id: purchaseConfig.purchase_preferred_unit_id,
    purchase_unit_chain: purchaseConfig.purchase_unit_chain,
    created_at: "",
    updated_at: "",
    updated_by: null,
  };
}

export function useSaveInputConfig() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: SavePayload) => {
      if (!establishmentId || !user) throw new Error("Missing context");

      // ── Compute purchase configs per product ──
      // When validationContext exists, compute from product structure.
      // Otherwise (bulk mode-only), use safe defaults.
      const purchaseByProduct = new Map<string, {
        purchase_mode: InputMode;
        purchase_preferred_unit_id: string | null;
        purchase_unit_chain: string[] | null;
      }>();

      if (payload.validationContext) {
        const { products, dbUnits, dbConversions } = payload.validationContext;

        for (const product of products) {
          const purchaseConfig = computePurchaseForProduct(product, dbUnits, payload);
          purchaseByProduct.set(product.id, purchaseConfig);

          const syntheticConfig = buildSyntheticConfig(
            product.id,
            establishmentId,
            payload,
            purchaseConfig,
          );

          // Validate ALL 3 contexts
          for (const ctx of ["purchase", "b2b_sale", "internal"] as const) {
            const result = resolveInputUnitForContext(
              product,
              ctx,
              syntheticConfig,
              dbUnits,
              dbConversions,
            );

            if (result.status !== "ok") {
              const reason = "reason" in result ? result.reason : "Configuration invalide";
              throw new Error(
                `Configuration invalide pour « ${product.nom_produit} » (${ctx}) : ${reason}`,
              );
            }
          }
        }
      }

      // ── PERSIST ──
      const rows = payload.productIds.map((productId) => {
        // Use pre-computed purchase config if available, otherwise safe defaults
        const purchase = purchaseByProduct.get(productId) ?? {
          purchase_mode: payload.purchase_mode ?? "integer",
          purchase_preferred_unit_id: payload.purchase_preferred_unit_id ?? null,
          purchase_unit_chain: null,
        };

        return {
          product_id: productId,
          establishment_id: establishmentId,
          reception_mode: payload.reception_mode,
          reception_preferred_unit_id: payload.reception_preferred_unit_id,
          reception_unit_chain: payload.reception_unit_chain,
          internal_mode: payload.internal_mode,
          internal_preferred_unit_id: payload.internal_preferred_unit_id,
          internal_unit_chain: payload.internal_unit_chain,
          purchase_mode: purchase.purchase_mode,
          purchase_preferred_unit_id: purchase.purchase_preferred_unit_id,
          purchase_unit_chain: purchase.purchase_unit_chain,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        };
      });

      const { error } = await supabase
        .from("product_input_config")
        .upsert(rows, { onConflict: "product_id,establishment_id" });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      const count = variables.productIds.length;
      toast.success(`Configuration appliquée à ${count} produit${count > 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["product-input-config", establishmentId] });
    },
    onError: (err) => {
      console.error("Save input config error:", err);
      toast.error(err.message || "Erreur lors de la sauvegarde");
    },
  });
}
