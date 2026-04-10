/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Calculations Hook V2.0 (supplier_id SSOT)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Hook dédié aux calculs des factures.
 * Séparé de l'UI pour maintenir la scalabilité.
 * 
 * RÈGLE SSOT: Regroupement par supplier_id (UUID FK)
 *             Le nom affiché provient de supplier_name (denormalisé)
 *             mais le GROUPING est strictement basé sur l'ID
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMemo } from "react";
import type { Invoice, SupplierMonthSummary } from "../types";

const UNKNOWN_SUPPLIER_NAME = "Fournisseur inconnu";

/**
 * Calculer les totaux par fournisseur pour un ensemble de factures
 * Regroupement par supplier_id (SSOT - jamais par nom)
 */
export function useInvoiceCalculations(invoices: Invoice[]) {
  /**
   * Agrégation par supplier_id (UUID)
   */
  const supplierSummaries = useMemo<SupplierMonthSummary[]>(() => {
    const summaryMap = new Map<string, SupplierMonthSummary>();

    for (const invoice of invoices) {
      // Clé de regroupement = supplier_id (SSOT)
      const supplierId = invoice.supplier_id;
      // Nom affiché = supplier_name (denormalisé sur invoice)
      const supplierName = invoice.supplier_name || UNKNOWN_SUPPLIER_NAME;

      const existing = summaryMap.get(supplierId);

      if (existing) {
        existing.invoice_count += 1;
        existing.total_amount += invoice.amount_eur;
        // Garder le nom le plus récent (au cas où il a été corrigé)
        if (invoice.supplier_name) {
          existing.supplier_name = invoice.supplier_name;
        }
      } else {
        summaryMap.set(supplierId, {
          supplier_id: supplierId,
          supplier_name: supplierName,
          invoice_count: 1,
          total_amount: invoice.amount_eur,
        });
      }
    }

    // Tri par total décroissant
    return Array.from(summaryMap.values()).sort(
      (a, b) => b.total_amount - a.total_amount
    );
  }, [invoices]);

  /**
   * Total général du mois
   */
  const monthTotal = useMemo(() => {
    return invoices.reduce((sum, inv) => sum + inv.amount_eur, 0);
  }, [invoices]);

  const invoiceCount = invoices.length;

  return {
    supplierSummaries,
    monthTotal,
    invoiceCount,
  };
}
