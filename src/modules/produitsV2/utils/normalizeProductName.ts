/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Name Normalization (ISOLATED from V1)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Copy of V1 logic to maintain isolation.
 * Used for anti-duplicate constraint on (establishment_id, name_normalized).
 */

export function normalizeProductNameV2(name: string): string {
  if (!name || typeof name !== "string") {
    return "";
  }

  return name
    .toLowerCase()
    .trim()
    // Remove accents
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Collapse multiple spaces
    .replace(/\s+/g, " ");
}
