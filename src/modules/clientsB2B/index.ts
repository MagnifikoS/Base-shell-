/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE CLIENTS B2B — Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * B2B partnership management (supplier-side view).
 * Invitation code generation + partner list.
 * Catalogue browsing + import (client-side view).
 *
 * RULES:
 * - Cross-org partnerships only (same-org rejected by RPC + CHECK constraint)
 * - Read-only partner profiles via SECURITY DEFINER RPC
 * - Catalogue = read-only vitrine, import via atomic RPC
 * - No FK to products/stock/invoices tables (except via import tracking)
 */

// Pages
export { ClientsB2BPage } from "./pages/ClientsB2BPage";

// Components (for use in Fournisseurs module)
export { RedeemCodeDialog } from "./components/RedeemCodeDialog";
export { PartnershipList } from "./components/PartnershipList";
export { B2BCatalogBrowser } from "./components/B2BCatalogBrowser";
export { B2BPartnerCatalogView } from "./components/B2BPartnerCatalogView";
export { B2BRecipeCatalog } from "./components/B2BRecipeCatalog";
export { PlatsFournisseursPage } from "./components/PlatsFournisseursPage";
