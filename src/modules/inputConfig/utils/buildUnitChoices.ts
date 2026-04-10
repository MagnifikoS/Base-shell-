/**
 * Builds user-facing "unit choices" from the ENGINE's resolved output.
 *
 * ARCHITECTURE: This is a DISPLAY utility that reads the source of truth
 * from `resolveProductUnitContext` (the BFS-validated reachable units).
 *
 * It does NOT:
 * - reconstruct units from raw conditionnement_config
 * - hard-code label combinations
 * - run BFS or conversions
 * - generate composite multi_level combos (Phase A cleanup)
 *
 * It DOES:
 * - transform ReachableUnit[] into human-readable UnitChoice[]
 * - apply context-aware ordering (reception vs internal)
 * - signal whether multi_level is structurally possible
 */

import type { ProductForConfig, InputMode } from "../types";
import type { ReachableUnit } from "@/core/unitConversion";

export interface UnitChoice {
  /** Unique key for React rendering & state */
  key: string;
  /** User-facing label, e.g. "En kg", "En Pack" */
  label: string;
  /** The InputMode this choice maps to (hidden from user) */
  mode: InputMode;
  /** Whether this choice supports the "partial quantities" toggle */
  supportsPartial: boolean;
  /** Primary unit ID for this choice (persisted as preferred_unit_id) */
  primaryUnitId: string | null;
}

// ─── Sort priorities ────────────────────────────────────────
// Lower = appears first in the list

const SORT_CONTINUOUS = 10;
const SORT_FINAL_UNIT = 20;
const SORT_PACKAGING_BASE = 30; // + level index for ordering

/**
 * Builds the list of SIMPLE unit choices for a product in a given context,
 * driven by the engine's BFS-validated reachable units.
 *
 * Multi-level is handled separately in the dialog via dynamic selects
 * (composition libre). This function only returns simple unit choices.
 *
 * @param product - The enriched product from the config list
 * @param reachableUnits - BFS-validated units from resolveProductUnitContext
 * @param context - "reception" (supplier-facing) or "internal" (operational)
 */
export function buildUnitChoicesFromEngine(
  product: ProductForConfig,
  reachableUnits: ReachableUnit[],
  context: "reception" | "internal",
): UnitChoice[] {
  if (reachableUnits.length === 0) return [];

  const finalUnitId = product.final_unit_id;
  const levels = product.packaging_levels;

  // Build a map of packaging type_unit_id → level index (0=top, 1=next, etc.)
  const packagingUnitToLevelIdx = new Map<string, number>();
  for (let i = 0; i < levels.length; i++) {
    if (levels[i].type_unit_id) {
      packagingUnitToLevelIdx.set(levels[i].type_unit_id!, i);
    }
  }

  const choices: (UnitChoice & UnitChoiceSortMeta)[] = [];

  // ── Simple unit choices (one reachable unit = one entry) ──
  for (const ru of reachableUnits) {
    const isPhysical = ru.family === "weight" || ru.family === "volume";
    const mode: InputMode = isPhysical ? "decimal" : "integer";
    const supportsPartial = !isPhysical && context === "internal";
    const isFinalUnit = ru.id === finalUnitId;
    const packagingIdx = packagingUnitToLevelIdx.get(ru.id);
    const isPackaging = packagingIdx !== undefined;

    // Compute sort order
    let sortOrder: number;
    if (isPhysical) {
      sortOrder = SORT_CONTINUOUS;
    } else if (isFinalUnit) {
      sortOrder = SORT_FINAL_UNIT;
    } else if (isPackaging) {
      sortOrder = SORT_PACKAGING_BASE + packagingIdx;
    } else {
      sortOrder = SORT_PACKAGING_BASE + 50;
    }

    choices.push({
      key: `unit-${ru.id}`,
      label: `En ${ru.name}`,
      mode,
      supportsPartial,
      primaryUnitId: ru.id,
      _sortOrder: sortOrder,
      _isFinalUnit: isFinalUnit,
      _isPhysical: isPhysical,
      _packagingIdx: packagingIdx ?? -1,
    });
  }

  // ── Sort by context ──
  sortByContext(choices, context);

  // Strip internal sort metadata
  return choices.map((c) => ({
    key: c.key,
    label: c.label,
    mode: c.mode,
    supportsPartial: c.supportsPartial,
    primaryUnitId: c.primaryUnitId,
  }));
}

// ─── Internal sort type ─────────────────────────────────────

interface UnitChoiceSortMeta {
  _sortOrder: number;
  _isFinalUnit: boolean;
  _isPhysical: boolean;
  _packagingIdx: number;
}

/**
 * Sorts choices in-place based on context.
 *
 * Both contexts sort from LARGEST packaging to SMALLEST (final unit),
 * with physical units (kg/L) at the end.
 *
 * RECEPTION & INTERNAL:
 *   top packaging → ... → final unit → continuous (kg/L)
 */
function sortByContext(choices: (UnitChoice & UnitChoiceSortMeta)[], _context: "reception" | "internal"): void {
  choices.sort((a, b) => {
    const aOrder = unifiedSortKey(a);
    const bOrder = unifiedSortKey(b);
    return aOrder - bOrder;
  });
}

function unifiedSortKey(c: UnitChoiceSortMeta): number {
  // Packaging units first, ordered by level index (0 = top/largest)
  if (c._packagingIdx >= 0 && !c._isPhysical) return c._packagingIdx;
  // Final unit after all packaging
  if (c._isFinalUnit) return 50;
  // Physical units last
  if (c._isPhysical) return 100;
  return 150;
}

// ─── Multi-level availability check ─────────────────────────

/**
 * Returns true if multi_level mode is structurally possible:
 * at least 2 reachable units exist that are packaging or final unit.
 * Used by the config dialog to show/hide the "saisie combinée" option.
 */
export function isMultiLevelPossible(
  product: ProductForConfig,
  reachableUnits: ReachableUnit[],
): boolean {
  if (reachableUnits.length < 2) return false;

  const levels = product.packaging_levels;
  const finalUnitId = product.final_unit_id;
  const reachableIds = new Set(reachableUnits.map((u) => u.id));

  // Count reachable packaging units + final unit
  let chainableCount = 0;
  for (const lvl of levels) {
    if (lvl.type_unit_id && reachableIds.has(lvl.type_unit_id)) {
      chainableCount++;
    }
  }
  if (finalUnitId && reachableIds.has(finalUnitId)) {
    chainableCount++;
  }

  return chainableCount >= 2;
}

/**
 * Returns the list of units eligible for multi-level chain selection.
 * Only packaging units + final unit that are BFS-reachable.
 */
export function getChainableUnits(
  product: ProductForConfig,
  reachableUnits: ReachableUnit[],
): ReachableUnit[] {
  const levels = product.packaging_levels;
  const finalUnitId = product.final_unit_id;
  const reachableIds = new Set(reachableUnits.map((u) => u.id));

  // Ordered: top packaging → bottom packaging → final unit
  const result: ReachableUnit[] = [];
  for (const lvl of levels) {
    if (lvl.type_unit_id && reachableIds.has(lvl.type_unit_id)) {
      const ru = reachableUnits.find((u) => u.id === lvl.type_unit_id);
      if (ru) result.push(ru);
    }
  }
  if (finalUnitId && reachableIds.has(finalUnitId)) {
    const ru = reachableUnits.find((u) => u.id === finalUnitId);
    if (ru) result.push(ru);
  }

  return result;
}

// ─── Restore from saved config ──────────────────────────────

/**
 * Finds the UnitChoice matching a saved config (mode + preferred unit ID).
 * Used to restore the dialog state from persisted configuration.
 *
 * Priority:
 * 1. Exact match on mode + primaryUnitId
 * 2. First choice with matching mode
 * 3. First choice (ultimate fallback)
 */
export function findChoiceForConfig(
  choices: UnitChoice[],
  mode: InputMode,
  preferredUnitId: string | null,
): UnitChoice {
  // Fraction is integer + partial toggle
  const effectiveMode = mode === "fraction" ? "integer" : mode;

  // Multi-level is handled separately (not in choices list)
  if (effectiveMode === "multi_level") {
    // Return first choice as fallback (dialog handles multi_level via unit_chain)
    return choices[0];
  }

  // Try exact match: mode + unit
  if (preferredUnitId) {
    const exact = choices.find(
      (c) => c.mode === effectiveMode && c.primaryUnitId === preferredUnitId,
    );
    if (exact) return exact;
  }

  // Fallback: first choice with matching mode
  const modeMatch = choices.find((c) => c.mode === effectiveMode);
  if (modeMatch) return modeMatch;

  // Ultimate fallback
  return choices[0];
}

