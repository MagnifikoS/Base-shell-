/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION — B2B Resolution Orchestration Hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates B2B billing unit + price resolution for a set of products.
 * Uses ONLY existing resolvers (fn_get_packaging_signature, fn_product_unit_price_factor).
 * ZERO local computation — pure orchestration.
 *
 * Usage: call `resolve(productIds, carrierProductId)` → get unit + prices.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveB2bBillingUnit,
  type ProductForBillingResolution,
  type UnitInfo,
  type BillingUnitResolution,
} from "../utils/resolveB2bBillingUnit";
import {
  resolveB2bPrices,
  type PriceResolution,
  type PriceStrategy,
} from "../services/resolveB2bPrice";

// ── Public types ─────────────────────────────────────────────────────────

export interface B2bResolutionResult {
  billing: BillingUnitResolution;
  pricing: PriceResolution;
}

export interface B2bResolvedData {
  b2bBillingUnitId: string;
  b2bUnitPrice: number;
  b2bPriceStrategy: PriceStrategy;
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useB2bResolution() {
  const [isResolving, setIsResolving] = useState(false);
  const [result, setResult] = useState<B2bResolutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Resolve B2B billing unit + prices for a set of product IDs.
   * Fetches product data internally — caller only provides IDs.
   */
  const resolve = useCallback(
    async (productIds: string[], carrierProductId: string) => {
      setIsResolving(true);
      setError(null);
      setResult(null);

      try {
        // 1. Fetch product data needed for resolution (DB fields only)
        const { data: rawProducts, error: pErr } = await supabase
          .from("products_v2")
          .select(
            "id, nom_produit, stock_handling_unit_id, final_unit_id, final_unit_price, supplier_billing_unit_id"
          )
          .in("id", productIds)
          .is("archived_at", null);

        if (pErr) throw new Error(`Erreur chargement produits: ${pErr.message}`);
        if (!rawProducts || rawProducts.length === 0)
          throw new Error("Aucun produit trouvé");

        const products: ProductForBillingResolution[] = rawProducts.map((p) => ({
          id: p.id as string,
          nom_produit: p.nom_produit as string,
          stock_handling_unit_id: p.stock_handling_unit_id as string,
          final_unit_id: p.final_unit_id as string,
          final_unit_price: p.final_unit_price as number | null,
          supplier_billing_unit_id: p.supplier_billing_unit_id as string | null,
        }));

        // 2. Fetch all measurement units for lookup
        const { data: units, error: uErr } = await supabase
          .from("measurement_units")
          .select("id, name, family, abbreviation");

        if (uErr) throw new Error(`Erreur chargement unités: ${uErr.message}`);

        const allUnits: UnitInfo[] = (units ?? []).map((u) => ({
          id: u.id as string,
          name: u.name as string,
          family: u.family as string,
          abbreviation: u.abbreviation as string,
        }));

        // 3. Resolve billing unit (via fn_get_packaging_signature RPC)
        const billing = await resolveB2bBillingUnit(products, allUnits);
        if (!billing) {
          throw new Error(
            "Impossible de déterminer l'unité B2B (familles d'unités incompatibles)"
          );
        }

        // 4. Resolve prices (via fn_product_unit_price_factor RPC)
        const pricing = await resolveB2bPrices(products, billing.billingUnitId);

        setResult({ billing, pricing });
        return { billing, pricing };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        setError(msg);
        return null;
      } finally {
        setIsResolving(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsResolving(false);
  }, []);

  return {
    resolve,
    reset,
    isResolving,
    result,
    error,
  };
}
