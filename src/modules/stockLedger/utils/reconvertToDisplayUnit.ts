/**
 * ═══════════════════════════════════════════════════════════════════════════
 * reconvertToDisplayUnit — BFS reconversion from canonical → display unit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared utility used by:
 *   - useWithdrawalHistory (qty display)
 *   - useBlRetraits (qty + price display)
 *
 * Uses the SAME BFS engine (conditionnementV2) — no parallel logic.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { findConversionPath } from "@/modules/conditionnementV2";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import { extractPackagingLevels, extractEquivalence } from "../engine/buildCanonicalLine";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { Json } from "@/integrations/supabase/types";

/**
 * Try to reconvert a canonical quantity to the target display unit via BFS.
 * Returns { quantity, unitName, factor } or null if no conversion path.
 */
export function reconvertToDisplayUnit(
  canonicalQty: number,
  canonicalUnitId: string | null,
  targetUnitId: string | null,
  targetUnitName: string | null,
  condConfig: Json | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): { quantity: number; unitName: string; factor: number } | null {
  if (!canonicalUnitId || !targetUnitId || !targetUnitName) return null;
  if (canonicalUnitId === targetUnitId) return { quantity: canonicalQty, unitName: targetUnitName, factor: 1 };

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

  const result = findConversionPath(
    canonicalUnitId,
    targetUnitId,
    dbUnits,
    dbConversions,
    packagingLevels,
    equivalence
  );

  if (result.reached && result.factor !== null && result.factor > 0) {
    return { quantity: canonicalQty * result.factor, unitName: targetUnitName, factor: result.factor };
  }
  return null;
}
