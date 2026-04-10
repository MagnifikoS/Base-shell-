/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Public Export V1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Point d'entrée unique du module Factures.
 * Module indépendant et supprimable (rm -rf src/modules/factures).
 *
 * INTÉGRATION:
 * - Import unique: import { FacturesPage } from "@/modules/factures"
 * - Route: /factures
 * - Sidebar: section "Achats & Stock"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Page principale
export { FacturesPage } from "./pages/FacturesPage";

// Types (si besoin externe)
export type { Invoice, MonthNavigation, SupplierMonthSummary } from "./types";
export { formatYearMonth, getCurrentMonth, toYearMonthString } from "./types";

// Service (pour création/suppression depuis Vision AI et autres modules)
export { createInvoice, deleteInvoice, downloadInvoiceFile } from "./services/invoiceService";
export type { CreateInvoiceParams } from "./services/invoiceService";

// Hooks (réutilisables par d'autres modules — Rapports, etc.)
export { useMonthInvoices } from "./hooks/useInvoices";
export { useInvoiceCalculations } from "./hooks/useInvoiceCalculations";

// Components (réutilisables par d'autres modules)
export { InvoiceDeleteDialog } from "./components/InvoiceDeleteDialog";
export { MonthSelector } from "./components/MonthSelector";
