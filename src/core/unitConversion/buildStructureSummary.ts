/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE — Build Structure Summary (Factored utility)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared utility for rendering a product's packaging/equivalence tree
 * and BFS coherence diagnostic.
 *
 * Used by: WizardStep5, InventoryProductDrawer, ProductDetailPage
 *
 * RULES:
 * - UUID-only resolution
 * - Zero hardcode, zero text fallback
 * - Uses findConversionPath for coherence check
 */

import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import { findConversionPath } from "@/modules/conditionnementV2";

export interface StructureSummaryLine {
  label: string; // e.g. "1 Carton = 12 Boîte"
  fromUnitId: string | null;
  toUnitId: string | null;
}

export interface StructureSummaryResult {
  lines: StructureSummaryLine[];
  /** All BFS paths valid between packaging levels */
  isCoherent: boolean;
  /** Human-readable diagnostic if incoherent */
  diagnosticMessage: string | null;
}

/**
 * Build a human-readable structure summary from packaging levels + equivalence.
 * Also checks BFS coherence between all connected unit pairs.
 */
export function buildStructureSummary(
  packagingLevels: PackagingLevel[],
  equivalence: Equivalence | null,
  finalUnit: string | null,
  finalUnitId: string | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): StructureSummaryResult {
  const lines: StructureSummaryLine[] = [];
  let allCoherent = true;
  const issues: string[] = [];

  // Packaging chain
  for (const level of packagingLevels) {
    if (level.type && level.containsQuantity && level.containsUnit) {
      lines.push({
        label: `1 ${level.type} = ${level.containsQuantity} ${level.containsUnit}`,
        fromUnitId: level.type_unit_id ?? null,
        toUnitId: level.contains_unit_id ?? null,
      });

      // Check BFS coherence for this level
      if (level.type_unit_id && level.contains_unit_id) {
        const path = findConversionPath(
          level.type_unit_id,
          level.contains_unit_id,
          dbUnits,
          dbConversions,
          packagingLevels,
          equivalence
        );
        if (!path.reached) {
          allCoherent = false;
          issues.push(`Pas de chemin BFS: ${level.type} → ${level.containsUnit}`);
        }
      }
    }
  }

  // Equivalence line
  if (equivalence && equivalence.quantity && equivalence.unit && equivalence.source_unit_id) {
    const sourceName = finalUnit || "unité";
    lines.push({
      label: `1 ${sourceName} = ${equivalence.quantity} ${equivalence.unit}`,
      fromUnitId: equivalence.source_unit_id,
      toUnitId: equivalence.unit_id ?? null,
    });
  }

  return {
    lines,
    isCoherent: allCoherent,
    diagnosticMessage: issues.length > 0 ? issues.join(" · ") : null,
  };
}
