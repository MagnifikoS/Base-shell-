/**
 * formatInputEntries — Client-side display helper for B2B order lines.
 *
 * Transforms `input_entries` (the persisted user-input intent) into a
 * human-readable string.  Falls back to `canonicalQuantity + unitLabel`
 * when `input_entries` is absent (legacy data).
 *
 * Examples:
 *   [{ quantity: 3, unit_label: "Boîte" }]               → "3 Boîtes"
 *   [{ quantity: 1, unit_label: "Carton" }, { … "Boîte" }] → "1 Carton + 2 Boîtes"
 */

import type { InputEntrySnapshot } from "../types";

/**
 * Naïve French pluralisation for unit labels.
 * Adds "s" when quantity > 1 unless the label already ends in "s" / "x" / "z".
 */
function pluralise(label: string, qty: number): string {
  if (qty <= 1) return label;
  const last = label.slice(-1).toLowerCase();
  if (last === "s" || last === "x" || last === "z") return label;
  return `${label}s`;
}

function formatEntry(entry: InputEntrySnapshot): string {
  // Display integers cleanly (3 instead of 3.00)
  const qtyStr = Number.isInteger(entry.quantity)
    ? String(entry.quantity)
    : String(Math.round(entry.quantity * 1000) / 1000);
  return `${qtyStr} ${pluralise(entry.unit_label, entry.quantity)}`;
}

/**
 * Format `input_entries` into a display string.
 *
 * @param inputEntries  Persisted snapshot (may be null for legacy lines)
 * @param fallbackQty   Canonical quantity to show when input_entries is absent
 * @param fallbackLabel Canonical unit label for fallback
 * @returns Human-readable quantity string
 */
export function formatInputEntries(
  inputEntries: InputEntrySnapshot[] | null | undefined,
  fallbackQty: number,
  fallbackLabel: string | null,
): string {
  if (inputEntries && inputEntries.length > 0) {
    return inputEntries.map(formatEntry).join(" + ");
  }
  // Legacy fallback — canonical display
  const qty = Number.isInteger(fallbackQty)
    ? String(fallbackQty)
    : String(Math.round(fallbackQty * 1000) / 1000);
  return `${qty} ${fallbackLabel ?? ""}`.trim();
}
