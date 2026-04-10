/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION — B2B Price Resolver (Pure Orchestrator)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Resolves B2B selling price for a mutualisation group by:
 * 1. Reading each member's final_unit_price + final_unit_id
 * 2. Converting all prices to the resolved billing unit via BFS RPC
 * 3. Comparing prices and proposing strategy
 *
 * CONSTRAINTS:
 * - NO local conversion logic — uses fn_product_unit_price_factor RPC
 * - NO writes — pure read + compute
 * - Isolated from stock, BFS engine, other modules
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { ProductForBillingResolution } from "../utils/resolveB2bBillingUnit";

// ── Types ────────────────────────────────────────────────────────────────

export interface MemberPrice {
  productId: string;
  productName: string;
  /** Original price in final_unit */
  originalPrice: number;
  originalUnitId: string;
  /** Price converted to billing unit */
  convertedPrice: number | null;
  /** Whether BFS conversion succeeded */
  conversionOk: boolean;
}

export type PriceStrategy = "carrier" | "average" | "manual" | "cheapest" | "most_expensive";

export interface PriceResolution {
  /** Per-member converted prices */
  memberPrices: MemberPrice[];
  /** Are all converted prices equal (within 0.01€ tolerance)? */
  pricesAreEqual: boolean;
  /** Average of all converted prices */
  averagePrice: number;
  /** All conversions succeeded? */
  allConversionsOk: boolean;
}

// ── Price tolerance ──────────────────────────────────────────────────────
const PRICE_EQUALITY_TOLERANCE = 0.01;

// ── Core resolver ────────────────────────────────────────────────────────

/**
 * Resolve B2B prices for all members of a mutualisation group.
 * Uses fn_product_unit_price_factor RPC (existing BFS engine) for conversion.
 *
 * @param products - Member products
 * @param billingUnitId - Resolved B2B billing unit
 * @returns Price resolution with per-member prices and comparison
 */
export async function resolveB2bPrices(
  products: ProductForBillingResolution[],
  billingUnitId: string
): Promise<PriceResolution> {
  const memberPrices: MemberPrice[] = [];

  // Convert each product's price to billing unit via BFS RPC
  for (const product of products) {
    if (product.final_unit_price === null) {
      memberPrices.push({
        productId: product.id,
        productName: product.nom_produit,
        originalPrice: 0,
        originalUnitId: product.final_unit_id,
        convertedPrice: null,
        conversionOk: false,
      });
      continue;
    }

    // If final_unit_id === billing unit, no conversion needed
    if (product.final_unit_id === billingUnitId) {
      memberPrices.push({
        productId: product.id,
        productName: product.nom_produit,
        originalPrice: product.final_unit_price,
        originalUnitId: product.final_unit_id,
        convertedPrice: product.final_unit_price,
        conversionOk: true,
      });
      continue;
    }

    // Call BFS RPC for price factor: final_unit → billing_unit
    const { data: factor, error } = await supabase.rpc("fn_product_unit_price_factor", {
      p_product_id: product.id,
      p_from_unit_id: product.final_unit_id,
      p_to_unit_id: billingUnitId,
    });

    if (error || factor === null || factor === undefined) {
      memberPrices.push({
        productId: product.id,
        productName: product.nom_produit,
        originalPrice: product.final_unit_price,
        originalUnitId: product.final_unit_id,
        convertedPrice: null,
        conversionOk: false,
      });
      continue;
    }

    const convertedPrice = Math.round(product.final_unit_price * (factor as number) * 10000) / 10000;

    memberPrices.push({
      productId: product.id,
      productName: product.nom_produit,
      originalPrice: product.final_unit_price,
      originalUnitId: product.final_unit_id,
      convertedPrice,
      conversionOk: true,
    });
  }

  // Analyze prices
  const validPrices = memberPrices
    .filter((m) => m.conversionOk && m.convertedPrice !== null)
    .map((m) => m.convertedPrice!);

  const allConversionsOk = memberPrices.every((m) => m.conversionOk);
  const averagePrice =
    validPrices.length > 0
      ? Math.round((validPrices.reduce((a, b) => a + b, 0) / validPrices.length) * 10000) / 10000
      : 0;

  const pricesAreEqual =
    validPrices.length > 0 &&
    validPrices.every((p) => Math.abs(p - validPrices[0]) <= PRICE_EQUALITY_TOLERANCE);

  return {
    memberPrices,
    pricesAreEqual,
    averagePrice,
    allConversionsOk,
  };
}
