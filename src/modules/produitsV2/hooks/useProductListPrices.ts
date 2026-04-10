/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useProductListPrices — Resolves display prices for a list of products
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Uses the SAME resolver (resolveDisplayPrice) as the detail page.
 * Returns a Map<productId, { label: string }> for efficient lookup.
 */

import { useMemo } from "react";
import { useUnitConversions } from "@/core/unitConversion";
import { resolveDisplayPrice, type PriceDisplayProduct } from "../services/priceDisplayResolver";
import type { ProductV2ListItem } from "../types";

export interface ResolvedPriceLabel {
  /** e.g. "10.00 €/kg" */
  label: string;
}

export function useProductListPrices(products: ProductV2ListItem[]): Map<string, ResolvedPriceLabel> {
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  return useMemo(() => {
    const map = new Map<string, ResolvedPriceLabel>();

    for (const p of products) {
      const priceProduct: PriceDisplayProduct = {
        final_unit_price: p.final_unit_price,
        final_unit_id: p.final_unit_id,
        supplier_billing_unit_id: p.supplier_billing_unit_id,
        price_display_unit_id: p.price_display_unit_id,
        conditionnement_config: p.conditionnement_config,
      };

      const result = resolveDisplayPrice(priceProduct, dbUnits, dbConversions);

      const price = result.convertedPrice ?? result.basePrice;
      const unitAbbr = result.displayUnitAbbr ?? result.baseUnitAbbr;

      if (price == null) {
        map.set(p.id, { label: "—" });
      } else if (unitAbbr) {
        map.set(p.id, { label: `${price.toFixed(2)} €/${unitAbbr}` });
      } else {
        map.set(p.id, { label: `${price.toFixed(2)} €` });
      }
    }

    return map;
  }, [products, dbUnits, dbConversions]);
}
