/**
 * ═══════════════════════════════════════════════════════════════════════════
 * convertPriceToLineUnit — Reconvert a price from its source unit to the
 * line's display unit via BFS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DISPLAY-ONLY: Does NOT modify DB values. Does NOT affect totals.
 *
 * Example:
 *   price = 0.0076 €/g, lineUnit = kg
 *   → BFS factor g→kg = 0.001
 *   → display price = 0.0076 / 0.001 = 7.60 €/kg
 *
 * Used by: BL App lines, Invoice App lines, Invoice PDF
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { findConversionPath } from "@/modules/conditionnementV2";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import { extractPackagingLevels, extractEquivalence } from "@/modules/stockLedger/engine/buildCanonicalLine";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { Json } from "@/integrations/supabase/types";

/**
 * Convert a unit price from priceUnitId to lineUnitId via BFS.
 * Returns the converted price or null if no conversion path exists.
 */
export function convertPriceToLineUnit(
  pricePerPriceUnit: number,
  priceUnitId: string,
  lineUnitId: string,
  condConfig: Json | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): number | null {
  if (priceUnitId === lineUnitId) return pricePerPriceUnit;

  const rawLevels = extractPackagingLevels(condConfig);
  const packagingLevels: PackagingLevel[] = rawLevels.map((l, i) => ({
    id: `level-${i}`,
    type: "",
    type_unit_id: l.type_unit_id,
    containsQuantity: l.quantity,
    containsUnit: "",
    contains_unit_id: l.contains_unit_id,
  }));
  const rawEquivalence = extractEquivalence(condConfig);
  const equivalence: Equivalence | null = rawEquivalence
    ? { source: "", source_unit_id: rawEquivalence.source_unit_id, quantity: rawEquivalence.quantity ?? 0, unit: "", unit_id: rawEquivalence.unit_id }
    : null;

  // Find factor: priceUnit → lineUnit
  // e.g. ml → L  factor = 0.001
  // price per L = price per ml / 0.001 = price per ml * 1000
  const result = findConversionPath(
    priceUnitId,
    lineUnitId,
    dbUnits,
    dbConversions,
    packagingLevels,
    equivalence
  );

  if (result.reached && result.factor !== null && result.factor > 0) {
    // 1 priceUnit = factor lineUnits
    // price per lineUnit = price per priceUnit / factor
    return pricePerPriceUnit / result.factor;
  }
  return null;
}
