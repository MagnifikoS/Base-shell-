/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE payLedger — Barrel export (index.ts)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Point d'entrée unique du module.
 * Les autres modules DOIVENT importer uniquement depuis ici.
 *
 * ISOLATION :
 *   - Ce module n'importe rien d'autres modules (factures, visionAI, etc.)
 *   - Supprimable sans régression : retirer les imports dans FacturesPage suffit
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Main UI components
export { PayLedgerSection }              from "./components/PayLedgerSection";
export { SupplierPaymentRulesPanel }     from "./components/SupplierPaymentRulesPanel";
export { SupplierPaymentsSection }       from "./components/SupplierPaymentsSection";
export { SupplierPaymentHistory }        from "./components/SupplierPaymentHistory";
export { PayToPayCockpit }               from "./components/PayToPayCockpit";
export { GlobalSupplierPaymentDialog }   from "./components/GlobalSupplierPaymentDialog";
export { PaymentTimelineDrawer }         from "./components/PaymentTimelineDrawer";

// Engine (public for testing + consumers)
export {
  computeInvoicePaid,
  computeInvoiceRemaining,
  computeInvoiceStatus,
  computeMonthRecap,
  computeExpectedDueDate,
  computeNextExpectedPayment,
  computeSupplierCredit,
  computeUrgency,
  urgencyLabel,
  urgencyColor,
  URGENCY_SORT,
  formatEurPay,
  formatDateKey,
  statusLabel,
  statusColor,
} from "./engine/payEngine";

// Engine hooks (public for consumers)
export {
  useEnsurePayInvoice,
  useBackfillPayInvoices,
  usePayInvoicePdfLink,
} from "./hooks/usePayLedger";

// Types (for consumers)
export type {
  PayInvoice,
  PayPayment,
  PayAllocation,
  PayAllocationWithVoidStatus,
  PaySupplierRule,
  PayScheduleItem,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  SupplierRuleMode,
  AllocationStrategy,
  MonthRecap,
  SupplierRecap,
} from "./types";

export type { UrgencyLevel } from "./engine/payEngine";

