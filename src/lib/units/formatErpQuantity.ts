/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ERP Quantity Display Engine — Human-readable packaging breakdown
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure display-only utility. No DB writes, no BFS mutation, no stock impact.
 *
 * RULES:
 * 1. Never show fractions on packaging units if a smaller unit exists
 * 2. Greedy decomposition from largest to smallest unit
 * 3. Max 10 levels by default (configurable)
 * 4. Works regardless of whether canonical is the largest or smallest unit
 * 5. If qty < smallest packaging → show in smallest unit directly
 * 6. If context unavailable → return null (caller uses fallback)
 * 7. Fractional remainder only on the LAST unit in the chain
 *
 * @example
 *   // canonical = Carton (factor=1), Boîte factor=0.1, Pièce factor=0.05
 *   formatErpQuantity(1.25, options)  → "1 Carton + 2 Boîte + 1 Pièce"
 *   formatErpQuantity(0.3, options)   → "3 Boîte"
 *   formatErpQuantity(1, options)     → "1 Carton"
 *   formatErpQuantity(0, options)     → "0 Carton"
 *
 *   // canonical = pce (factor=1), Carton factor=10, Boîte factor=2
 *   formatErpQuantity(13, options)    → "1 Carton + 1 Boîte + 1 pce"
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ReachableUnit } from "@/core/unitConversion/resolveProductUnitContext";
import { displayUnitName } from "./displayUnitName";

export interface ErpSegment {
  unitName: string;
  unitAbbreviation: string;
  quantity: number;
}

export interface ErpQuantityResult {
  /** Human-readable label: "1 Carton + 3 Boîte" */
  label: string;
  /** Individual segments for custom rendering */
  segments: ErpSegment[];
}

/** Tolerance for floating point comparisons */
const EPSILON = 1e-6;

/**
 * Format a canonical quantity into a human-readable ERP packaging breakdown.
 *
 * @param canonicalQty - Quantity in canonical (target) unit (factorToTarget = 1)
 * @param options      - BFS-reachable units from resolveProductUnitContext
 * @param maxLevels    - Maximum decomposition depth (default: 10)
 * @returns ErpQuantityResult, or null if options are insufficient for breakdown
 */
export function formatErpQuantity(
  canonicalQty: number,
  options: ReachableUnit[],
  maxLevels = 10,
): ErpQuantityResult | null {
  if (!options || options.length === 0) return null;

  const canonical = options.find((o) => o.factorToTarget === 1);
  if (!canonical) return null;

  const canonicalDisplay = displayUnitName({
    name: canonical.name,
    abbreviation: canonical.abbreviation,
  });

  // Zero → show "0 <canonical>"
  if (canonicalQty === 0) {
    return {
      label: `0 ${canonicalDisplay}`,
      segments: [{ unitName: canonical.name, unitAbbreviation: canonical.abbreviation, quantity: 0 }],
    };
  }

  // Only canonical available → show qty in canonical unit (no breakdown needed)
  if (options.length === 1) {
    return {
      label: `${fmtQty(canonicalQty)} ${canonicalDisplay}`,
      segments: [{ unitName: canonical.name, unitAbbreviation: canonical.abbreviation, quantity: canonicalQty }],
    };
  }

  // ─── Build decomposition chain ───
  // STRICT RULE: Never mix units from different families (e.g. weight + count).
  // Only use packaging-chain units (target, packaging, delivery, reference) for display.
  // Cross-family units (physical, equivalence, billing) are for INPUT, not decomposition.
  const DISPLAY_KINDS = new Set(["target", "packaging", "delivery", "reference"]);
  const canonicalFamily = canonical.family;

  // Step 1: Collect all same-family units (strict filter — canonical always included)
  // Packaging & delivery units are ALWAYS part of the product's decomposition chain
  // (defined in conditionnement_config), so they must never be filtered by family.
  const isSameFamily = (o: ReachableUnit) =>
    o.id === canonical.id ||
    (canonicalFamily != null && o.family === canonicalFamily) ||
    o.kind === "packaging" ||
    o.kind === "delivery";

  // Preferred pool: display-kind units in the same family
  const sameFamilyDisplayUnits = options.filter(
    (o) => DISPLAY_KINDS.has(o.kind) && isSameFamily(o),
  );

  // Fallback pool: ANY same-family unit (even non-display kinds like equivalence)
  const sameFamilyAll = options.filter(isSameFamily);

  // CRITICAL: if no same-family decomposition is possible, use canonical alone.
  // NEVER fall back to cross-family units — canonical-only is always safe.
  const pool =
    sameFamilyDisplayUnits.length > 1
      ? sameFamilyDisplayUnits
      : sameFamilyAll.length > 1
        ? sameFamilyAll
        : [canonical];

  const allUnitsSorted = [...pool].sort((a, b) => b.factorToTarget - a.factorToTarget);

  // Greedy decomposition from largest to smallest
  const segments: ErpSegment[] = [];
  let remainder = canonicalQty;
  const isNegative = remainder < 0;
  remainder = Math.abs(remainder);

  for (let i = 0; i < allUnitsSorted.length; i++) {
    if (segments.length >= maxLevels) break;
    if (remainder < EPSILON) break;

    const unit = allUnitsSorted[i];
    const factor = unit.factorToTarget;
    const isLastUnit = i === allUnitsSorted.length - 1 || segments.length === maxLevels - 1;

    if (isLastUnit) {
      // Last unit in chain (or last allowed level): absorb all remainder (may be fractional)
      const qty = Math.round(remainder / factor * 10000) / 10000;
      if (qty > EPSILON) {
        segments.push({
          unitName: unit.name,
          unitAbbreviation: unit.abbreviation,
          quantity: Math.round(qty * 100) / 100,
        });
      }
      remainder = 0;
    } else {
      // Not the last unit: take only whole number, pass remainder down
      const whole = Math.floor(remainder / factor + EPSILON);
      if (whole > 0) {
        segments.push({
          unitName: unit.name,
          unitAbbreviation: unit.abbreviation,
          quantity: whole,
        });
        remainder = Math.round((remainder - whole * factor) * 10000) / 10000;
        // Clamp tiny negatives from float math
        if (remainder < 0) remainder = 0;
      }
    }
  }

  // If nothing was captured (shouldn't happen), bail
  if (segments.length === 0) return null;

  // Build label
  const sign = isNegative ? "-" : "";
  const label =
    sign +
    segments
      .map(
        (s) =>
          `${fmtQty(s.quantity)} ${displayUnitName({ name: s.unitName, abbreviation: s.unitAbbreviation })}`,
      )
      .join(" + ");

  return { label, segments };
}

/** Format number: integers as-is, decimals to 2 places max */
function fmtQty(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return (Math.round(n * 100) / 100).toString();
}
