/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WIZARD CANONICAL HELPERS — Packaging detection for UI guidance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure utility: detects if a unit is a "packaging" type based on the
 * measurement_units.category field (SSOT from DB).
 *
 * Used in WizardStep4 (warning + grouped dropdown) and WizardStep5 (badge).
 * Does NOT affect any business logic, BFS, or stock operations.
 */

interface UnitLike {
  category?: string;
  family?: string | null;
  kind?: string;
}

/**
 * Returns true if the unit is a packaging/conditioning unit.
 *
 * Detection strategy (multi-signal, ordered by reliability):
 * 1. kind === "packaging" (from BFS ReachableUnit — most reliable in wizard context)
 * 2. category === "packaging" (from measurement_units.category column)
 * 3. family === "packaging" (from measurement_units.family column)
 */
export function isPackagingUnit(unit: UnitLike): boolean {
  if (unit.kind === "packaging") return true;
  if (unit.category === "packaging") return true;
  if (unit.family === "packaging") return true;
  return false;
}
