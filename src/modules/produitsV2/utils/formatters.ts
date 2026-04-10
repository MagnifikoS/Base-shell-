/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Formatters (ISOLATED)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Format price with € symbol
 */
export function formatPriceV2(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2)} €`;
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string | null, maxLength = 50): string {
  if (!text) return "—";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}
