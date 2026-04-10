/**
 * Shared display utilities for inventory components.
 * Extracted from DesktopInventoryView for file-size compliance.
 */

/** Smart rounding: <1 -> 3 dec, >=1 -> 2 dec, strip trailing zeros */
export function formatQtyDisplay(qty: number): string {
  const abs = Math.abs(qty);
  const decimals = abs < 1 ? 3 : 2;
  return parseFloat(qty.toFixed(decimals)).toString();
}
