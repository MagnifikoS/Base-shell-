/**
 * ===============================================================================
 * MODULE FACTURES -- Types V1.1 (supplier_name ajoute)
 * ===============================================================================
 *
 * Types pour le module Factures independant.
 * Utilise la table `invoices` existante comme SSOT.
 *
 * REGLES SSOT:
 * - invoice_number = valide user = SSOT
 * - invoice_date = valide user = SSOT
 * - invoice_total (amount_eur) = valide user
 * - supplier_name = valide user (NON bloquant)
 *
 * NOTE: MonthNavigation and related utils are now in @/modules/shared/monthNavigation
 * and re-exported here for backward compatibility.
 * ===============================================================================
 */

// Re-export shared month navigation (SSOT now in shared module)
export type { MonthNavigation } from "@/modules/shared";
export { formatYearMonth, getCurrentMonth, toYearMonthString } from "@/modules/shared";

/**
 * Facture telle que stockee dans la table `invoices`
 */
export interface Invoice {
  id: string;
  establishment_id: string;
  organization_id: string;
  supplier_id: string;
  supplier_name: string | null;
  supplier_name_normalized: string | null;
  invoice_number: string | null;
  invoice_date: string; // format YYYY-MM-DD
  amount_eur: number;
  file_path: string;
  file_name: string;
  file_size: number;
  file_type: string;
  is_paid: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  amount_ht?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
}

/**
 * Fournisseur avec ses factures agregees pour un mois
 * Utilise supplier_id (FK) pour le regroupement stable (SSOT)
 */
export interface SupplierMonthSummary {
  supplier_id: string; // UUID du fournisseur (SSOT)
  supplier_name: string; // Nom affiche (depuis invoice_suppliers.name idealement)
  invoice_count: number;
  total_amount: number;
}
