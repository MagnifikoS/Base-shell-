/**
 * Accent-safe search normalization.
 * Strips diacritics + lowercases for robust .includes() matching.
 * Use on BOTH the haystack (product name) and needle (search input).
 */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
