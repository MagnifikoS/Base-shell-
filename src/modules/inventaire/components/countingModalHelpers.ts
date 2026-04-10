/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COUNTING MODAL — Helpers, types, and constants
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from CountingModal.tsx for file size compliance.
 * Pure functions: navigation, field ordering, breakdown computation.
 */

import type { InventoryLineWithProduct } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_QUANTITY = 99999;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CountingModalMode = "comptage" | "correction";

export interface UnitField {
  unitId: string;
  quantity: string;
  abbreviation: string;
  name: string;
  factorToTarget: number;
  kind: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Navigation by lineId + display_order (INVARIANT 3)
// ─────────────────────────────────────────────────────────────────────────────

export function findNextUncountedLineId(
  lines: InventoryLineWithProduct[],
  afterDisplayOrder: number
): string | null {
  for (const l of lines) {
    if (l.display_order > afterDisplayOrder && l.counted_at === null && !l.product_archived)
      return l.id;
  }
  for (const l of lines) {
    if (l.counted_at === null && !l.product_archived) return l.id;
  }
  return null;
}

export function findFirstUncountedLineId(lines: InventoryLineWithProduct[]): string | null {
  const line = lines.find((l) => l.counted_at === null && !l.product_archived);
  return line?.id ?? null;
}

export function getCountedLineIds(lines: InventoryLineWithProduct[]): string[] {
  return lines.filter((l) => l.counted_at !== null).map((l) => l.id);
}

export function getPrevLineId(
  lines: InventoryLineWithProduct[],
  currentLineId: string
): string | null {
  const idx = lines.findIndex((l) => l.id === currentLineId);
  return idx > 0 ? lines[idx - 1].id : null;
}

export function getNextLineId(
  lines: InventoryLineWithProduct[],
  currentLineId: string
): string | null {
  const idx = lines.findIndex((l) => l.id === currentLineId);
  return idx >= 0 && idx < lines.length - 1 ? lines[idx + 1].id : null;
}
