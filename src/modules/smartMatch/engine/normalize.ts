/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — Normalization (pure functions, no DB, no React)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Aligned with normalizeProductNameV2 (produitsV2/utils)
 * and normalizeProductName (edge functions _shared).
 */

/**
 * Normalize a product label for matching (lowercase, no accents, collapsed spaces)
 */
export function normalizeLabel(name: string): string {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate a stable normalized_key for alias storage
 * Format: lowercase, no accents, spaces→underscores, alphanumeric only
 */
export function buildNormalizedKey(label: string): string {
  if (!label) return "";
  return normalizeLabel(label)
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Compute text similarity (Dice coefficient on bigrams)
 * Returns 0–1 where 1 = identical
 */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < na.length - 1; i++) {
    bigramsA.add(na.substring(i, i + 2));
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < nb.length - 1; i++) {
    bigramsB.add(nb.substring(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}
