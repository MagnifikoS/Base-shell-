/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — applyMutualisation (Pure presentation layer)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Transforms a flat product list into a display list with grouped rows.
 * This is a PURE FUNCTION — no side-effects, no writes, no state mutation.
 *
 * Guarantees:
 * - Individual products are NEVER removed — only wrapped in groups
 * - Group seuil = carrier product's min_stock_quantity_canonical (no duplication)
 * - When toggle OFF, this function is simply never called
 * - Returns the same DesktopProductStock[] shape for ungrouped products
 */

import type { MutualisationGroup } from "../types";

/**
 * A display item that is either a regular product or a group header.
 * The group header carries aggregated data but the children remain
 * individually addressable.
 */
export interface MutualisationDisplayItem<T extends { product_id: string }> {
  type: "product" | "group";
  /** For type="product": the original product. For type="group": null */
  product: T | null;
  /** For type="group": the group metadata */
  group: {
    id: string;
    displayName: string;
    carrierProductId: string;
    children: T[];
  } | null;
}

/**
 * Apply mutualisation grouping to a flat product list.
 *
 * Products belonging to a group are replaced by a single group header
 * containing the children. Ungrouped products pass through unchanged.
 *
 * @param products - Flat list of products (READ-ONLY)
 * @param groups - Active mutualisation groups from DB
 * @param allProducts - (Optional) Complete unfiltered product list used to
 *   collect ALL group members regardless of current view filters.
 *   When omitted, falls back to `products` (legacy behaviour).
 * @returns Display items mixing group headers and individual products
 */
export function applyMutualisation<T extends { product_id: string }>(
  products: T[],
  groups: MutualisationGroup[],
  allProducts?: T[]
): MutualisationDisplayItem<T>[] {
  if (groups.length === 0) {
    return products.map((p) => ({ type: "product" as const, product: p, group: null }));
  }

  // Build a map: product_id → group
  const productToGroup = new Map<string, MutualisationGroup>();
  for (const g of groups) {
    for (const m of g.members) {
      productToGroup.set(m.product_id, g);
    }
  }

  const result: MutualisationDisplayItem<T>[] = [];
  const emittedGroupIds = new Set<string>();

  for (const product of products) {
    const group = productToGroup.get(product.product_id);

    if (!group) {
      // Ungrouped product — pass through
      result.push({ type: "product", product, group: null });
      continue;
    }

    if (emittedGroupIds.has(group.id)) {
      // Already emitted this group header — skip (child is inside the group)
      continue;
    }

    // First product of this group encountered — emit group header
    emittedGroupIds.add(group.id);

    // Collect all children from the FULL product list (not the filtered view)
    // so that group stock aggregation always reflects ALL real members.
    const source = allProducts ?? products;
    const children = source.filter((p) => productToGroup.get(p.product_id)?.id === group.id);

    result.push({
      type: "group",
      product: null,
      group: {
        id: group.id,
        displayName: group.display_name,
        carrierProductId: group.carrier_product_id,
        children,
      },
    });
  }

  return result;
}
