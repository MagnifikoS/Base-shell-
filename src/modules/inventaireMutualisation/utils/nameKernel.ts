/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Name Kernel (Pure utility, no side-effects)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracts a "semantic kernel" from a product name and computes
 * Jaccard similarity between two kernels.
 *
 * Example:
 *   "Lasagne Rummo 500g"  → Set{"lasagne"}
 *   "Lasagne Molisana 1kg" → Set{"lasagne"}
 *   → Jaccard = 1.0  (identical kernel)
 *
 * Stopwords include brand names, weights, packaging info, and
 * common French food filler words so only the *ingredient essence* remains.
 */

// ── Stopword list (lowercase, no accents) ────────────────────────────────
const STOPWORDS = new Set([
  // Units & quantities
  "g", "kg", "ml", "cl", "l", "lt", "mg", "dl",
  // Packaging
  "x", "pce", "pcs", "piece", "pieces", "lot", "bte", "boite",
  "barquette", "sachet", "paquet", "pack", "bidon", "bouteille",
  "carton", "seau", "fut", "palette", "rouleau", "tube",
  // Common filler
  "de", "du", "des", "le", "la", "les", "au", "aux", "en", "et",
  "a", "un", "une", "par", "pour", "avec", "sans",
  // Quality markers (keep generic)
  "bio", "aop", "aoc", "igp", "label", "rouge", "extra", "fin",
  "premium", "standard",
]);

/**
 * Returns true if the token looks like a pure number or number+unit (e.g. "500g", "1,5kg").
 */
function isNumericToken(token: string): boolean {
  return /^\d+([.,]\d+)?\s*[a-z]*$/.test(token);
}

/**
 * Normalize a string: lowercase, strip accents, collapse whitespace.
 * Mirrors the existing `normalizeProductName` convention.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the semantic kernel of a product name as a Set of tokens.
 */
export function extractKernel(name: string): Set<string> {
  const tokens = normalize(name).split(" ");
  const kernel = new Set<string>();

  for (const t of tokens) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    if (isNumericToken(t)) continue;
    kernel.add(t);
  }

  return kernel;
}

/**
 * Jaccard similarity between two sets: |A ∩ B| / |A ∪ B|.
 * Returns 0 if both sets are empty.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Threshold above which two products are considered "similar". */
export const SIMILARITY_THRESHOLD = 0.5;

/**
 * Convenience: check if two product names are similar.
 */
export function areNamesSimilar(nameA: string, nameB: string): boolean {
  return jaccardSimilarity(extractKernel(nameA), extractKernel(nameB)) >= SIMILARITY_THRESHOLD;
}
