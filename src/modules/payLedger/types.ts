/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE payLedger — Types Phase 1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT : pay_* tables (dette + événements paiements)
 * EURO ONLY — aucune devise, aucun multi-devise.
 * Statut payé = calculé, jamais stocké.
 *
 * NOTE: types.ts Supabase est auto-généré et ne contient pas encore ces tables.
 * On définit nos propres types ici. Le service utilise `as unknown as T`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Méthode de paiement (liste fermée) */
export type PaymentMethod =
  | "virement"
  | "prelevement"
  | "carte"
  | "espece"
  | "autre";

/** Source du paiement */
export type PaymentSource = "manuel" | "auto";

/** Statut calculé d'une dette — jamais stocké en DB */
export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";

/** Mode de la règle fournisseur */
export type SupplierRuleMode =
  | "none"
  | "manual_transfer"
  | "direct_debit_delay"
  | "direct_debit_fixed_day"
  | "installments";

/** Stratégie d'allocation */
export type AllocationStrategy = "fifo_oldest" | "current_month_first" | "manual";

/** Source d'un échéancier */
export type ScheduleSource = "manuel" | "rule";

/** Dette comptable (pay_invoices) */
export interface PayInvoice {
  id: string;
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  amount_eur: number;
  invoice_date: string; // YYYY-MM-DD
  label: string | null;
  source_invoice_id: string | null;
  created_at: string;
  created_by: string;
}

/** Événement paiement — append-only (pay_payments) */
export interface PayPayment {
  id: string;
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  payment_date: string; // YYYY-MM-DD
  amount_eur: number;
  method: PaymentMethod;
  payment_source: PaymentSource;
  note: string | null;
  idempotency_key: string | null;
  external_ref: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  created_by: string;
}

/** Allocation paiement → dette (pay_allocations) */
export interface PayAllocation {
  id: string;
  organization_id: string;
  establishment_id: string;
  payment_id: string;
  pay_invoice_id: string;
  amount_eur: number;
  created_at: string;
  created_by: string;
}

/** Allocation enrichie avec le statut void du paiement parent */
export interface PayAllocationWithVoidStatus extends PayAllocation {
  payment_voided_at: string | null;
}

/** Règle paiement fournisseur (pay_supplier_rules) */
export interface PaySupplierRule {
  id: string;
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  mode: SupplierRuleMode;
  delay_days: number | null;
  fixed_day_of_month: number | null;
  /** Nombre d'échéances pour le mode installments (2–5) */
  installment_count: number | null;
  /** Jours fixes du mois pour chaque échéance (1–28), ex: [5, 15, 25] */
  installment_days: number[] | null;
  allow_partial: boolean;
  allocation_strategy: AllocationStrategy;
  /**
   * UI uniquement — si true, le cockpit affiche un récap mensuel global
   * (sans actions par facture) même pour les modes delay/fixed_day.
   * N'affecte aucun calcul ni chemin de paiement.
   */
  is_monthly_aggregate: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

/** Échéancier attendu (pay_schedule_items) */
export interface PayScheduleItem {
  id: string;
  organization_id: string;
  establishment_id: string;
  supplier_id: string;
  pay_invoice_id: string | null;
  due_date: string; // YYYY-MM-DD
  expected_amount_eur: number | null;
  source: ScheduleSource;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  created_by: string;
}

/** Récap mensuel calculé par payEngine */
export interface MonthRecap {
  total_dette: number;
  total_paye: number;
  reste_a_payer: number;
  by_supplier: SupplierRecap[];
}

/** Récap par fournisseur */
export interface SupplierRecap {
  supplier_id: string;
  total_dette: number;
  total_paye: number;
  reste: number;
  status: PaymentStatus;
}

/** Paramètres de paiement par établissement (pay_establishment_settings) */
export interface PayEstablishmentSettings {
  establishment_id: string;
  organization_id: string;
  auto_record_direct_debit: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/** Compteurs structurés retournés par generateDueAutoPayments */
export interface AutoPayResult {
  created: number;
  skipped_already_paid: number;
  skipped_no_rule: number;
  skipped_not_due: number;
  skipped_already_recorded: number;
  errors: string[];
}
