/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Format supplier stock for display in the order creation screen.
 *
 * RULE: Stock must be projected into the AUTHORIZED ORDERING UNITS
 * (b2b_sale context), not shown as raw canonical.
 *
 * Uses the client-side product data only — zero cross-org access.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  resolveInputUnitForContext,
  type ProductForResolution,
  type InputResolutionResult,
} from "@/modules/inputConfig/utils/resolveInputUnitForContext";
import { computeDisplayBreakdown } from "@/core/unitConversion/computeDisplayBreakdown";
import type { ProductInputConfigRow } from "@/modules/inputConfig/types";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { displayUnitName } from "@/lib/units/displayUnitName";

/**
 * Format a supplier stock quantity into the ordering units authorized
 * for this product (b2b_sale context).
 *
 * @returns Formatted label like "10 Cartons" or "1 Carton + 2 Boîtes", or null if projection impossible.
 */
export function formatSupplierStockForOrder(
  canonicalStock: number,
  product: ProductForResolution,
  config: ProductInputConfigRow | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): string | null {
  if (canonicalStock <= 0) return "0";

  // Resolve the authorized ordering units via b2b_sale context
  const resolution = resolveInputUnitForContext(product, "b2b_sale", config, dbUnits, dbConversions);

  if (resolution.status !== "ok") {
    // No valid config → cannot project, return null (caller shows raw fallback)
    return null;
  }

  // Get BFS reachable units for breakdown computation
  const engineInput: ProductUnitInput = {
    stock_handling_unit_id: product.stock_handling_unit_id,
    final_unit_id: product.final_unit_id,
    delivery_unit_id: product.delivery_unit_id ?? null,
    supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
    conditionnement_config: product.conditionnement_config as ProductUnitInput["conditionnement_config"],
  };
  const unitContext = resolveProductUnitContext(engineInput, dbUnits, dbConversions);
  const reachableUnits = unitContext.allowedInventoryEntryUnits;

  if (resolution.mode === "multi_level") {
    // Multi-level: use the first unit in chain as top display unit for greedy breakdown
    // Filter reachable units to ONLY the authorized chain units
    const chainSet = new Set(resolution.unitChain);
    const authorizedUnits = reachableUnits.filter((u) => chainSet.has(u.id));

    if (authorizedUnits.length === 0) return null;

    // Find top unit (largest factorToTarget) in the chain
    const topUnit = authorizedUnits.reduce((a, b) =>
      a.factorToTarget > b.factorToTarget ? a : b
    );

    const breakdown = computeDisplayBreakdown(canonicalStock, topUnit.id, authorizedUnits);
    return breakdown.label;
  }

  // Single unit mode: project stock into that single unit
  const targetUnit = reachableUnits.find((u) => u.id === resolution.unitId);
  if (!targetUnit || targetUnit.factorToTarget === 0) return null;

  const projected = Math.round((canonicalStock / targetUnit.factorToTarget) * 100) / 100;
  const unitLabel = displayUnitName({ name: resolution.unitName, abbreviation: targetUnit.abbreviation });

  return `${formatQty(projected)} ${unitLabel}`;
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return (Math.round(n * 100) / 100).toString();
}
