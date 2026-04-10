/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOLERANCE CHECK — Shared utility (Réception + Retrait)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT: uses resolveProductUnitContext BFS to convert canonical → tolerance unit.
 * No "mini-BFS" maison. No hardcoded thresholds.
 *
 * Returns null if no tolerance configured or within range.
 * Returns a warning object if outside range.
 */

import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";

export interface ToleranceConfig {
  min: number | null;
  max: number | null;
  unitId: string | null;
}

export interface ToleranceWarning {
  isBelow: boolean;
  isAbove: boolean;
  /** Quantity in the tolerance unit */
  qtyInTolUnit: number;
  /** The tolerance unit abbreviation */
  tolUnitAbbr: string;
  /** The tolerance unit name */
  tolUnitName: string;
  /** Canonical total in canonical unit */
  canonicalTotal: number;
  /** Canonical unit abbreviation */
  canonicalAbbr: string;
  min: number | null;
  max: number | null;
}

export function checkTolerance(params: {
  canonicalQuantity: number;
  canonicalUnitId: string;
  tolerance: ToleranceConfig | null | undefined;
  product: ProductUnitInput;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
}): ToleranceWarning | null {
  const { canonicalQuantity, canonicalUnitId, tolerance, product, dbUnits, dbConversions } = params;

  // No tolerance configured → no warning
  if (!tolerance || (tolerance.min == null && tolerance.max == null)) return null;

  const tolUnitId = tolerance.unitId ?? canonicalUnitId;
  const tolUnit = dbUnits.find((u) => u.id === tolUnitId);
  const canonicalUnit = dbUnits.find((u) => u.id === canonicalUnitId);

  // Convert canonical → tolerance unit using BFS
  let qtyInTolUnit = canonicalQuantity;

  if (tolUnitId !== canonicalUnitId) {
    const ctx = resolveProductUnitContext(product, dbUnits, dbConversions);
    if (ctx) {
      // Find the tolerance unit in the reachable units
      const reachable = ctx.allowedInventoryEntryUnits.find((u) => u.id === tolUnitId);
      if (reachable && reachable.factorToTarget > 0) {
        // canonicalQty is already in canonical unit (factor=1 direction)
        // factorToTarget = how many canonical units per tolerance unit
        // So: qtyInTolUnit = canonicalQty / factorToTarget
        qtyInTolUnit = canonicalQuantity / reachable.factorToTarget;
      }
    }
  }

  const rounded = Math.round(qtyInTolUnit * 100) / 100;
  const isBelow = tolerance.min != null && rounded < tolerance.min;
  const isAbove = tolerance.max != null && rounded > tolerance.max;

  if (!isBelow && !isAbove) return null;

  return {
    isBelow,
    isAbove,
    qtyInTolUnit: rounded,
    tolUnitAbbr: tolUnit?.abbreviation ?? "",
    tolUnitName: tolUnit?.name ?? "",
    canonicalTotal: Math.round(canonicalQuantity * 10000) / 10000,
    canonicalAbbr: canonicalUnit?.abbreviation ?? "",
    min: tolerance.min,
    max: tolerance.max,
  };
}
