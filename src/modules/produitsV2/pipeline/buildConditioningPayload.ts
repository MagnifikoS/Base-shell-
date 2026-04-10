/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILD CONDITIONING PAYLOAD — Pure functions for conditioning config & resume
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from ProductFormV3Modal.tsx (L201-229) — PR-2.
 * Zero side effects, zero React, zero hooks.
 */

import type { PackagingLevel, PriceLevel, Equivalence, ConditioningConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// INPUTS
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildConditioningConfigInput {
  finalUnit: string | null;
  finalUnitId: string | null;
  packagingLevels: PackagingLevel[];
  effectivePriceLevel: PriceLevel | null;
  billedUnitId: string | null;
  equivalenceObject: Equivalence | null;
}

export interface BuildConditioningResumeInput {
  packagingLevels: PackagingLevel[];
  finalUnit: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildConditioningConfig
// Source : ProductFormV3Modal.tsx L201-218
// ─────────────────────────────────────────────────────────────────────────────

export function buildConditioningConfig(
  input: BuildConditioningConfigInput,
): ConditioningConfig | null {
  if (!input.finalUnit && input.packagingLevels.length === 0) {
    return null;
  }

  return {
    finalUnit: input.finalUnit,
    final_unit_id: input.finalUnitId,
    packagingLevels: input.packagingLevels.map((level) => ({ ...level })),
    priceLevel: input.effectivePriceLevel
      ? {
          ...input.effectivePriceLevel,
          billed_unit_id: input.billedUnitId ?? undefined,
        }
      : null,
    equivalence: input.equivalenceObject ? { ...input.equivalenceObject } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildConditioningResume
// Source : ProductFormV3Modal.tsx L220-229
// ─────────────────────────────────────────────────────────────────────────────

export function buildConditioningResume(
  input: BuildConditioningResumeInput,
): string {
  if (input.packagingLevels.length === 0) {
    return input.finalUnit ? `Vendu à l'unité (${input.finalUnit})` : "";
  }
  const firstLevel = input.packagingLevels[0];
  if (firstLevel?.type && firstLevel?.containsQuantity && firstLevel?.containsUnit) {
    return `${firstLevel.type} de ${firstLevel.containsQuantity} ${firstLevel.containsUnit}`;
  }
  return "";
}
