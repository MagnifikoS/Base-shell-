/**
 * Money utility helpers for Cash Module
 */

interface CashValues {
  cb_eur: number;
  cash_eur: number;
  delivery_eur: number;
  courses_eur: number;
  maintenance_eur: number;
  shortage_eur: number;
  advance_eur?: number;
}

/** Coefficient applied to delivery amounts for CA calculation */
export const DELIVERY_COEFFICIENT = 0.64;

/**
 * Calculate the Chiffre d'Affaires (revenue) for a cash day report.
 * Formula: CB + Espèces + (Livraison × 0.64) + Courses
 *
 * Courses are added to revenue (operational purchases resold).
 * Livraison is weighted at 64% (platform commission model).
 * Maintenance and shortage are NOT part of revenue.
 */
export function calculateCA(values: CashValues): number {
  return (
    values.cb_eur +
    values.cash_eur +
    values.delivery_eur * DELIVERY_COEFFICIENT +
    values.courses_eur
  );
}

/**
 * Calculate the cash balance (reconciliation) for a cash day report.
 * Formula: CA - Maintenance - Manque - Acompte
 *
 * This represents the net position after accounting for all cash movements.
 */
export function calculateBalance(values: CashValues): number {
  return (
    calculateCA(values) -
    values.maintenance_eur -
    values.shortage_eur -
    (values.advance_eur ?? 0)
  );
}

/**
 * @deprecated Use calculateCA instead. This alias exists for backward compatibility.
 */
export function calculateTotal(values: CashValues): number {
  return calculateCA(values);
}

/**
 * Format a number as EUR currency
 */
export function formatEur(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Parse a string input to a number, defaulting to 0
 */
export function parseEurInput(value: string): number {
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(",", ".");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
