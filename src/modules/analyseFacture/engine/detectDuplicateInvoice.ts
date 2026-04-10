/**
 * Duplicate Invoice Detection Engine
 *
 * 3 detection strategies (from strongest to weakest):
 * 1. EXACT: supplier_id + invoice_number match
 * 2. ROBUST: supplier_id + invoice_date + invoice_total exact match
 * 3. FUZZY: supplier_id + invoice_date + |total_diff| <= 0.50€ + |items_diff| <= 1
 *
 * RÈGLE SSOT:
 * - Si supplierId est null → status: "not_checked", isDuplicate: null
 * - Si supplierId existe → status: "checked", isDuplicate: boolean
 * - JAMAIS retourner isDuplicate: false quand supplierId est null
 */

import { InvoiceRecord, DuplicateInvoiceResult } from "../types";

interface DetectOptions {
  supplierId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTotal: number | null;
  itemsCount: number;
  existingInvoices: InvoiceRecord[];
}

/**
 * Detect if an invoice is a duplicate using 3 strategies
 *
 * @returns DuplicateInvoiceResult avec status explicite
 */
export function detectDuplicateInvoice(options: DetectOptions): DuplicateInvoiceResult {
  const { supplierId, invoiceNumber, invoiceDate, invoiceTotal, itemsCount, existingInvoices } =
    options;

  // ═══════════════════════════════════════════════════════════════════════════
  // GUARD: Cannot detect without supplier_id → status: "not_checked"
  // INTERDIT de retourner isDuplicate: false ici (faux négatif)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!supplierId) {
    return {
      status: "not_checked",
      isDuplicate: null,
      reason: null,
      existingInvoice: null,
      explanation: null,
    };
  }

  // Filter invoices from same supplier
  const supplierInvoices = existingInvoices.filter((inv) => inv.supplier_id === supplierId);

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 1: EXACT MATCH (supplier_id + invoice_number)
  // ═══════════════════════════════════════════════════════════════════════════
  if (invoiceNumber && invoiceDate) {
    const exactMatch = supplierInvoices.find(
      (inv) =>
        inv.invoice_number?.toLowerCase().trim() === invoiceNumber.toLowerCase().trim() &&
        inv.invoice_date === invoiceDate
    );

    if (exactMatch) {
      return {
        status: "checked",
        isDuplicate: true,
        reason: "exact_match",
        existingInvoice: exactMatch,
        explanation: `Même fournisseur + même numéro de facture (${invoiceNumber}) + même date (${invoiceDate})`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 2: ROBUST MATCH (supplier_id + invoice_date + invoice_total)
  // ═══════════════════════════════════════════════════════════════════════════
  if (invoiceDate && invoiceTotal !== null) {
    const robustMatch = supplierInvoices.find(
      (inv) => inv.invoice_date === invoiceDate && inv.amount_eur === invoiceTotal
    );

    if (robustMatch) {
      return {
        status: "checked",
        isDuplicate: true,
        reason: "robust_match",
        existingInvoice: robustMatch,
        explanation: `Même fournisseur + même date (${invoiceDate}) + même total (${invoiceTotal.toFixed(2)}€)`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 3: FUZZY MATCH (supplier_id + date + ~total ±0.50€ + ~items ±1)
  // ═══════════════════════════════════════════════════════════════════════════
  if (invoiceDate && invoiceTotal !== null && itemsCount > 0) {
    const TOTAL_TOLERANCE = 0.5; // €
    const ITEMS_TOLERANCE = 1;

    const fuzzyMatch = supplierInvoices.find((inv) => {
      if (inv.invoice_date !== invoiceDate) return false;

      const totalDiff = Math.abs(inv.amount_eur - invoiceTotal);
      if (totalDiff > TOTAL_TOLERANCE) return false;

      // items_count comparison (if available)
      if (inv.items_count !== undefined) {
        const itemsDiff = Math.abs(inv.items_count - itemsCount);
        if (itemsDiff > ITEMS_TOLERANCE) return false;
      }

      return true;
    });

    if (fuzzyMatch) {
      return {
        status: "checked",
        isDuplicate: true,
        reason: "fuzzy_match",
        existingInvoice: fuzzyMatch,
        explanation: `Même fournisseur + même date (${invoiceDate}) + total similaire (écart ≤0.50€)`,
      };
    }
  }

  // No duplicate found — status: "checked", isDuplicate: false
  return {
    status: "checked",
    isDuplicate: false,
    reason: null,
    existingInvoice: null,
    explanation: null,
  };
}
