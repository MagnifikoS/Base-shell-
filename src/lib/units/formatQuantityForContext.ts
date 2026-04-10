/**
 * ═══════════════════════════════════════════════════════════════════════════
 * formatQuantityForContext — Project canonical quantity into context unit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Generic utility that projects a canonical stock quantity into the
 * display unit configured for a given business context (purchase, b2b_sale,
 * internal).
 *
 * Used by: MobileReceptionView (added-line badges), Stock list, etc.
 * This file MUST NOT write to DB — purely ephemeral display logic.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  resolveInputUnitForContext,
  type ProductForResolution,
  type InputContext,
} from "@/modules/inputConfig/utils/resolveInputUnitForContext";
import type { ProductInputConfigRow } from "@/modules/inputConfig/types";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import { displayUnitName } from "@/lib/units/displayUnitName";

/**
 * Format a canonical quantity into the unit configured for the given context.
 *
 * @returns Formatted label like "2 Bidon" or "1 Carton + 2 Boîtes", or null if projection impossible.
 */
export function formatQuantityForContext(
  canonicalQty: number,
  product: ProductForResolution,
  context: InputContext,
  config: ProductInputConfigRow | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): string | null {
  if (canonicalQty === 0) return "0";

  const resolution = resolveInputUnitForContext(product, context, config, dbUnits, dbConversions);

  if (resolution.status !== "ok") return null;

  if (resolution.mode === "multi_level") {
    // Multi-level: greedy breakdown using the chain
    const chainSet = new Set(resolution.unitChain);
    const chainUnits = resolution.reachableUnits.filter((u) => chainSet.has(u.id));
    if (chainUnits.length === 0) return null;

    // Sort by factorToTarget DESC (largest first)
    const sorted = [...chainUnits].sort((a, b) => b.factorToTarget - a.factorToTarget);
    const segments: string[] = [];
    let remainder = Math.abs(canonicalQty);

    for (const unit of sorted) {
      if (remainder <= 0) break;
      const isLast = unit.factorToTarget === 1 || unit === sorted[sorted.length - 1];
      if (isLast) {
        const qty = Math.round(remainder * 10000) / 10000;
        if (qty > 0) {
          segments.push(`${formatQty(qty)} ${displayUnitName({ name: unit.name, abbreviation: unit.abbreviation })}`);
        }
        remainder = 0;
      } else {
        const qty = Math.floor(remainder / unit.factorToTarget);
        if (qty > 0) {
          segments.push(`${qty} ${displayUnitName({ name: unit.name, abbreviation: unit.abbreviation })}`);
          remainder = Math.round((remainder - qty * unit.factorToTarget) * 10000) / 10000;
        }
      }
    }

    return segments.length > 0 ? segments.join(" + ") : null;
  }

  // Single unit: direct conversion
  const targetUnit = resolution.reachableUnits.find((u) => u.id === resolution.unitId);
  if (!targetUnit || targetUnit.factorToTarget === 0) return null;

  const projected = Math.round((Math.abs(canonicalQty) / targetUnit.factorToTarget) * 10000) / 10000;
  const unitLabel = displayUnitName({ name: resolution.unitName, abbreviation: targetUnit.abbreviation });

  return `${formatQty(projected)} ${unitLabel}`;
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return (Math.round(n * 100) / 100).toString();
}
