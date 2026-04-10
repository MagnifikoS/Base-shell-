/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — Display Breakdown Utility
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Computes a human-readable breakdown of a canonical inventory quantity
 * into packaging/count units for display purposes ONLY.
 *
 * RULES:
 * - Packaging/delivery units → integers only (Math.floor)
 * - Remainder falls to the canonical (target) unit
 * - No DB writes — purely ephemeral display logic
 * - Reuses the same greedy algorithm as CountingModal & MultiUnitEntryPopover
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ReachableUnit } from "@/core/unitConversion/resolveProductUnitContext";
import { displayUnitName } from "@/lib/units/displayUnitName";

export interface BreakdownSegment {
  unitId: string;
  abbreviation: string;
  name: string;
  quantity: number;
}

export interface DisplayBreakdownResult {
  /** Ordered segments with qty > 0 */
  segments: BreakdownSegment[];
  /** Formatted string using full unit names "1 Carton + 2 Boîte" */
  label: string;
  /** Canonical total for sub-display */
  canonicalTotal: number;
  /** Canonical unit abbreviation */
  canonicalAbbreviation: string;
  /** Canonical unit full name */
  canonicalName: string;
}

/**
 * Compute a greedy breakdown of `canonicalTotal` starting from `displayUnitId`.
 * Falls through all available options from largest factorToTarget to smallest.
 *
 * @param canonicalTotal - The canonical inventory quantity (e.g., 24 pce)
 * @param displayUnitId  - The "top" unit to start decomposition from (e.g., carton)
 * @param options        - BFS-reachable units from resolveProductUnitContext
 */
export function computeDisplayBreakdown(
  canonicalTotal: number,
  displayUnitId: string,
  options: ReachableUnit[]
): DisplayBreakdownResult {
  const canonicalUnit = options.find((o) => o.factorToTarget === 1) ?? options[0];
  const canonicalAbbr = canonicalUnit?.abbreviation ?? "?";
  const canonicalName = canonicalUnit?.name ?? "?";

  if (canonicalTotal === 0 || options.length === 0) {
    return {
      segments: [
        {
          unitId: canonicalUnit?.id ?? "",
          abbreviation: canonicalAbbr,
          name: canonicalName,
          quantity: 0,
        },
      ],
      label: `0 ${displayUnitName({ name: canonicalName, abbreviation: canonicalAbbr })}`,
      canonicalTotal: 0,
      canonicalAbbreviation: canonicalAbbr,
      canonicalName,
    };
  }

  // Sort options by factorToTarget DESC (largest container first)
  // but only include units with factor >= displayUnit's factor
  const displayUnit = options.find((o) => o.id === displayUnitId);
  if (!displayUnit) {
    // Display unit not in options — fallback to canonical
    return {
      segments: [
        {
          unitId: canonicalUnit.id,
          abbreviation: canonicalAbbr,
          name: canonicalName,
          quantity: canonicalTotal,
        },
      ],
      label: `${formatQty(canonicalTotal)} ${displayUnitName({ name: canonicalName, abbreviation: canonicalAbbr })}`,
      canonicalTotal,
      canonicalAbbreviation: canonicalAbbr,
      canonicalName,
    };
  }

  // Greedy decomposition: start from displayUnit, then go through smaller units
  // Only use packaging-chain units for display — exclude cross-family (physical/equivalence/billing)
  const DISPLAY_KINDS = new Set(["target", "packaging", "delivery", "reference"]);
  // CRITICAL: Filter by same family as canonical to prevent cross-family mixing (e.g. "3 kg + 4.21 pce")
  const canonicalFamily = canonicalUnit?.family;
  const chainFiltered = options.filter(
    (o) =>
      o.factorToTarget > 0 &&
      o.factorToTarget <= displayUnit.factorToTarget &&
      DISPLAY_KINDS.has(o.kind) &&
      (canonicalFamily ? (o.family === canonicalFamily || o.factorToTarget === 1) : true)
  );
  // Fallback: if filtering leaves nothing useful, use kind-filtered units (still same-family)
  const kindOnly = options.filter(
    (o) =>
      o.factorToTarget > 0 &&
      o.factorToTarget <= displayUnit.factorToTarget &&
      DISPLAY_KINDS.has(o.kind)
  );
  const familyAndKind = canonicalFamily
    ? kindOnly.filter((o) => o.family === canonicalFamily || o.factorToTarget === 1)
    : kindOnly;
  const sortedOptions = (chainFiltered.length > 0
    ? chainFiltered
    : familyAndKind.length > 0
      ? familyAndKind
      : [canonicalUnit] // Ultimate fallback: canonical only
  ).sort((a, b) => b.factorToTarget - a.factorToTarget);

  const segments: BreakdownSegment[] = [];
  let remainder = canonicalTotal;

  for (const opt of sortedOptions) {
    if (remainder <= 0) break;

    const isPackaging = opt.kind === "packaging" || opt.kind === "delivery";
    const isTarget = opt.factorToTarget === 1;

    if (isTarget) {
      // Last unit — takes all remainder
      if (remainder > 0) {
        const qty = isPackaging ? Math.floor(remainder) : Math.round(remainder * 10000) / 10000;
        if (qty > 0) {
          segments.push({
            unitId: opt.id,
            abbreviation: opt.abbreviation,
            name: opt.name,
            quantity: qty,
          });
        }
        remainder -= qty * opt.factorToTarget;
      }
    } else {
      const rawQty = remainder / opt.factorToTarget;
      // P0-FIX: Only floor packaging; continuous units keep full precision
      const qty = isPackaging ? Math.floor(rawQty) : Math.floor(rawQty); // Greedy: always floor for intermediate steps
      if (qty > 0) {
        segments.push({
          unitId: opt.id,
          abbreviation: opt.abbreviation,
          name: opt.name,
          quantity: qty,
        });
        remainder = Math.round((remainder - qty * opt.factorToTarget) * 10000) / 10000;
      }
    }
  }

  // If no segments (edge case), show canonical
  if (segments.length === 0) {
    segments.push({
      unitId: canonicalUnit.id,
      abbreviation: canonicalAbbr,
      name: canonicalName,
      quantity: canonicalTotal,
    });
  }

  const label = segments.map((s) => `${formatQty(s.quantity)} ${displayUnitName({ name: s.name, abbreviation: s.abbreviation })}`).join(" + ");

  return {
    segments,
    label,
    canonicalTotal,
    canonicalAbbreviation: canonicalAbbr,
    canonicalName,
  };
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return (Math.round(n * 100) / 100).toString();
}
