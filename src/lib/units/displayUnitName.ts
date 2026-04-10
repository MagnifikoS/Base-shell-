/**
 * ═══════════════════════════════════════════════════════════════════════════
 * displayUnitName — Centralized unit name display logic
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RULES:
 *  - Physical standard units (kg, g, mg, L, cL, mL) → show ABBREVIATION
 *  - "pce" → show "pce" (widely understood shorthand)
 *  - All other units (packaging, delivery, billing) → show FULL NAME
 *    in Title Case singular French (Carton, Bouteille, Rouleau…)
 *
 * This function is DISPLAY-ONLY. It does NOT modify DB values.
 * It does NOT affect conversions, BFS, or stock calculations.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Standard physical abbreviations that should remain short.
 * These are universally understood scientific abbreviations.
 */
const PHYSICAL_STANDARD_ABBREVIATIONS = new Set([
  "kg", "g", "mg",
  "L", "l", "cL", "cl", "mL", "ml",
]);

/**
 * Short aliases that are also OK to keep abbreviated.
 * "pce" is widely used in French inventory systems.
 */
const ACCEPTED_SHORT_ALIASES = new Set<string>([]);

export interface DisplayUnitInput {
  name: string;
  abbreviation: string;
}

/**
 * Returns the display-friendly label for a measurement unit.
 *
 * @param unit - Object with at least `name` and `abbreviation`
 * @returns The label to show in UI
 *
 * @example
 * displayUnitName({ name: "Carton", abbreviation: "car" })  // → "Carton"
 * displayUnitName({ name: "Kilogramme", abbreviation: "kg" }) // → "kg"
 * displayUnitName({ name: "Pièce", abbreviation: "pce" })     // → "Pièce"
 */
export function displayUnitName(unit: DisplayUnitInput): string {
  const abbr = unit.abbreviation?.trim();

  // Physical standards → keep abbreviation
  if (abbr && PHYSICAL_STANDARD_ABBREVIATIONS.has(abbr)) {
    return abbr;
  }

  // Accepted short aliases
  if (abbr && ACCEPTED_SHORT_ALIASES.has(abbr.toLowerCase())) {
    return abbr;
  }

  // Everything else → full name (Title Case already in DB)
  const name = unit.name?.trim();
  if (name) return name;

  // Ultimate fallback
  return abbr || "?";
}

/**
 * Returns the short label for compact contexts (e.g., recap lines, badges).
 * Same as displayUnitName but caps at ~10 chars with ellipsis.
 */
export function displayUnitNameCompact(unit: DisplayUnitInput, maxLen = 10): string {
  const full = displayUnitName(unit);
  if (full.length <= maxLen) return full;
  return full.slice(0, maxLen - 1) + "…";
}

/**
 * Check if a unit is a physical standard (should keep abbreviation).
 */
export function isPhysicalStandard(abbreviation: string): boolean {
  return PHYSICAL_STANDARD_ABBREVIATIONS.has(abbreviation?.trim());
}
