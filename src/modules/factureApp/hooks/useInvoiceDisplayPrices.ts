/**
 * useInvoiceDisplayPrices — Project invoice lines into the billing unit.
 *
 * DISPLAY-ONLY: Reads snapshot fields from app_invoice_lines.
 * NO cross-org reads, NO runtime product lookups.
 *
 * ═══ ARCHITECTURE ═══
 * billed_unit_id, billed_unit_label, billed_quantity, billed_unit_price
 * are snapshotted at invoice generation time in fn_generate_app_invoice.
 * This hook simply maps them for display.
 *
 * Legacy fallback: if billed_* fields are NULL (old invoices generated
 * before the migration), falls back to canonical values.
 */

import { useMemo } from "react";
import type { AppInvoiceLine } from "../types";

export interface DisplayInvoiceLine extends AppInvoiceLine {
  /** Price in billing unit for display */
  display_unit_price: number;
  /** Quantity projected into billing unit */
  display_quantity: number;
  /** Billing unit label (e.g. "bte", "kg") */
  display_unit_label: string;
  /** True if billing differs from canonical */
  has_billing_projection: boolean;
  /** Non-null if projection failed */
  projection_error: string | null;
}

/**
 * Given invoice lines with snapshotted billing fields, return display-ready lines.
 */
export function useInvoiceDisplayPrices(
  lines: AppInvoiceLine[] | undefined
): DisplayInvoiceLine[] {
  return useMemo<DisplayInvoiceLine[]>(() => {
    if (!lines) return [];

    return lines.map((line) => {
      // Use snapshotted billing fields if available
      const hasBilledSnapshot =
        line.billed_unit_id != null &&
        line.billed_unit_label != null &&
        line.billed_quantity != null &&
        line.billed_unit_price != null;

      if (hasBilledSnapshot) {
        const isSameUnit = line.billed_unit_id === line.canonical_unit_id;
        return {
          ...line,
          display_unit_price: line.billed_unit_price!,
          display_quantity: line.billed_quantity!,
          display_unit_label: line.billed_unit_label!,
          has_billing_projection: !isSameUnit,
          projection_error: null,
        };
      }

      // Legacy fallback: no billed_* fields → use canonical values
      return {
        ...line,
        display_unit_price: line.unit_price,
        display_quantity: line.quantity,
        display_unit_label: line.unit_label_snapshot ?? "unité",
        has_billing_projection: false,
        projection_error: null,
      };
    });
  }, [lines]);
}
