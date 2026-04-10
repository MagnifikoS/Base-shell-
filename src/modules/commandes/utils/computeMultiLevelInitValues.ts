/**
 * Greedy decomposition of a canonical quantity into multi-level unit values.
 * Used to pre-fill the UQM multi_level stepper from a canonical quantity.
 */
import { resolveInputConversion } from "@/modules/stockLedger/utils/resolveInputConversion";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { Json } from "@/integrations/supabase/types";

export function computeMultiLevelInitValues(
  canonicalQty: number,
  unitChain: string[],
  unitFamilies: (string | null)[],
  canonicalUnitId: string,
  condConfig: Json | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): number[] {
  if (canonicalQty <= 0 || unitChain.length === 0) {
    return unitChain.map(() => 0);
  }

  // Compute factor for each level unit → canonical
  const factors: (number | null)[] = unitChain.map((unitId) => {
    if (unitId === canonicalUnitId) return 1;
    const conv = resolveInputConversion(unitId, canonicalUnitId, condConfig, dbUnits, dbConversions);
    return conv.factor;
  });

  // Greedy decomposition: biggest unit first
  let remaining = canonicalQty;
  const values: number[] = [];
  for (let i = 0; i < unitChain.length; i++) {
    const factor = factors[i];
    if (!factor || factor <= 0) {
      values.push(0);
      continue;
    }
    const family = unitFamilies[i] ?? null;
    const isPhysical = family === "weight" || family === "volume";
    if (i === unitChain.length - 1) {
      // Last level: take remainder (allow decimals for physical units)
      const val = +(remaining / factor).toFixed(4);
      values.push(isPhysical ? val : Math.floor(val));
    } else {
      const count = Math.floor(remaining / factor);
      values.push(count);
      remaining -= count * factor;
    }
  }

  return values;
}
