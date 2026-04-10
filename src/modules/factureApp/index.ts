/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURE APP — Public Export
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Module isolé de facturation in-app (distinct des factures importées).
 *
 * INTÉGRATION:
 * - Fournisseur : FacturesEmisesTab dans l'onglet Commandes ou Factures
 * - Client : AppInvoicesClientList dans la page Factures existante
 * - Commande : GenerateInvoiceButton dans CommandeDetailDialog
 *
 * SUPPRESSION COMPLÈTE:
 * 1. Supprimer src/modules/factureApp/
 * 2. Retirer les imports dans CommandeDetailDialog, FacturesPage
 * 3. DROP TABLE app_invoice_lines; DROP TABLE app_invoices;
 * 4. DROP SEQUENCE app_invoice_seq;
 * 5. DROP FUNCTION fn_generate_app_invoice;
 */

// Components
export { FacturesEmisesTab } from "./components/FacturesEmisesTab";
export { AppInvoicesClientList } from "./components/AppInvoicesClientList";
export { GenerateInvoiceButton } from "./components/GenerateInvoiceButton";
export { AppInvoiceDetailSheet } from "./components/AppInvoiceDetailSheet";

// Hooks
export {
  useAppInvoices,
  useAppInvoiceDetail,
  useInvoiceForCommande,
  useGenerateAppInvoice,
} from "./hooks/useFactureApp";

// Types
export type {
  AppInvoice,
  AppInvoiceLine,
  AppInvoiceWithLines,
} from "./types";
