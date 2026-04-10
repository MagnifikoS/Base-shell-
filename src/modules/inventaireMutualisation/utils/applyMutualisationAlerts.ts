/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — applyMutualisationAlerts (Pure function)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Transforms a flat StockAlertItem[] into a display list where:
 * - Individual alerts of grouped products are HIDDEN (not deleted)
 * - A single group-level alert replaces them using:
 *   • Aggregated estimated_quantity (sum of all members)
 *   • Carrier product's min_stock_quantity_canonical (NO new seuil)
 *
 * Guarantees:
 * - Source alert data is NEVER mutated
 * - Individual alerts still exist in the original array
 * - When toggle OFF, this function is simply never called
 */

import type { MutualisationGroup } from "../types";

export interface AlertDisplayItem<T extends { product_id: string }> {
  type: "individual" | "group";
  /** For individual: the original alert item */
  item: T | null;
  /** For group: aggregated group alert */
  groupAlert: {
    groupId: string;
    displayName: string;
    carrierProductId: string;
    /** Sum of estimated_quantity of all members */
    aggregatedQuantity: number | null;
    /** Carrier product's min_stock (from the carrier item itself) */
    carrierMinStock: number | null;
    /** Alert level computed from aggregated quantity vs carrier threshold */
    alertLevel: "rupture" | "warning" | "ok" | "error";
    /** All member items (preserved for drill-down) */
    members: T[];
  } | null;
}

/**
 * Compute group alert level from aggregated quantity vs carrier threshold.
 */
function computeGroupAlertLevel(
  aggregatedQty: number | null,
  minStock: number | null
): "rupture" | "warning" | "ok" | "error" {
  if (aggregatedQty === null) return "error";
  if (aggregatedQty <= 0) return "rupture";
  if (minStock !== null && aggregatedQty < minStock) return "warning";
  return "ok";
}

/**
 * Apply mutualisation grouping to a flat alert list.
 *
 * @param alerts - Flat list of alert items (READ-ONLY, needs product_id + estimated_quantity + min_stock_canonical)
 * @param groups - Active mutualisation groups
 * @param allAlerts - (Optional) Complete unfiltered alert list used to collect ALL group members
 *   regardless of current view filters. When omitted, falls back to `alerts` (legacy behaviour).
 * @returns Display items mixing group alerts and individual alerts
 */
export function applyMutualisationAlerts<
  T extends {
    product_id: string;
    estimated_quantity: number | null;
    min_stock_canonical: number | null;
  }
>(alerts: T[], groups: MutualisationGroup[], allAlerts?: T[]): AlertDisplayItem<T>[] {
  if (groups.length === 0) {
    return alerts.map((a) => ({ type: "individual" as const, item: a, groupAlert: null }));
  }

  // Build product → group map
  const productToGroup = new Map<string, MutualisationGroup>();
  for (const g of groups) {
    for (const m of g.members) {
      productToGroup.set(m.product_id, g);
    }
  }

  const result: AlertDisplayItem<T>[] = [];
  const emittedGroupIds = new Set<string>();

  for (const alert of alerts) {
    const group = productToGroup.get(alert.product_id);

    if (!group) {
      result.push({ type: "individual", item: alert, groupAlert: null });
      continue;
    }

    if (emittedGroupIds.has(group.id)) continue;
    emittedGroupIds.add(group.id);

    // Collect all member alerts from the FULL list (not the filtered view)
    const source = allAlerts ?? alerts;
    const members = source.filter((a) => productToGroup.get(a.product_id)?.id === group.id);

    // Aggregate quantity
    const hasAnyNull = members.some((m) => m.estimated_quantity === null);
    const aggregatedQuantity = hasAnyNull
      ? null
      : members.reduce((sum, m) => sum + Math.max(0, m.estimated_quantity ?? 0), 0);

    // Carrier's min_stock (from carrier's own alert item, NOT duplicated)
    const carrierAlert = members.find((m) => m.product_id === group.carrier_product_id);
    const carrierMinStock = carrierAlert?.min_stock_canonical ?? null;

    result.push({
      type: "group",
      item: null,
      groupAlert: {
        groupId: group.id,
        displayName: group.display_name,
        carrierProductId: group.carrier_product_id,
        aggregatedQuantity,
        carrierMinStock,
        alertLevel: computeGroupAlertLevel(aggregatedQuantity, carrierMinStock),
        members,
      },
    });
  }

  return result;
}
