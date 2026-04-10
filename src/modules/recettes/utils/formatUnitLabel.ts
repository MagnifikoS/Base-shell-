/**
 * Format unit label for display in Recettes module.
 * Short metric units (kg, g, L, ml, cl) → abbreviation.
 * Everything else (Carton, Pièce, Pack…) → full name.
 */

const SHORT_ABBREVS = new Set(["kg", "g", "l", "ml", "cl"]);

export function formatUnitLabel(unit: { name: string; abbreviation: string }): string {
  const abbr = unit.abbreviation?.toLowerCase();
  if (abbr && SHORT_ABBREVS.has(abbr)) {
    return unit.abbreviation;
  }
  return unit.name || unit.abbreviation || "—";
}
