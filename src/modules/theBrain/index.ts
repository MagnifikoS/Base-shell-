/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Module Index (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Point d'entrée public du module THE BRAIN.
 * Module isolé et supprimable : rm -rf src/modules/theBrain/
 *
 * @see README.md pour les règles et comment supprimer
 */

// Page
export { TheBrainPage } from "./pages/TheBrainPage";

// Service
export {
  logEvent,
  brainSafeLog,
  getHealthSummary,
  getSubjectsSummary,
  getRecentEvents,
  // Phase 4 - Product Matching
  upsertProductMatchingRule,
  getBestProductRuleSuggestion,
  // Phase 4 - Supplier Matching
  upsertSupplierMatchingRule,
  getBestSupplierRuleSuggestion,
} from "./services/theBrainService";

// Phase 4 Types - Product Matching
export type {
  UpsertProductRuleParams,
  BrainProductSuggestion,
  GetProductSuggestionParams,
} from "./services/theBrainService";

// Phase 4 Types - Supplier Matching (from types.ts)
export type {
  UpsertSupplierRuleParams,
  BrainSupplierSuggestion,
  GetSupplierSuggestionParams,
} from "./types";

// Hook
export { useBrainHealth } from "./hooks/useBrainHealth";

// Plugins
export {
  logSupplierConfirmed,
  logSupplierCorrected,
  logSupplierConfirmedHeaderPicker,
} from "./plugins/supplierMatching";

export {
  logProductMatchConfirmed,
  logProductMatchCorrected,
  logProductCreatedFromInvoice,
  logProductMatchConfirmedSupplierOnly,
} from "./plugins/productMatching";

export { logPurchaseObserved, logPurchaseLinesBatch } from "./plugins/purchaseMonitoring";

export { logPriceEvolutionBatch } from "./plugins/priceEvolution";

export { logInvoiceVoided } from "./plugins/invoiceLifecycle";

// Types
export type {
  BrainEvent,
  BrainRule,
  LogEventParams,
  HealthSummary,
  SubjectSummary,
  DateRange,
  BrainHealthData,
} from "./types";

// Constants
export {
  THE_BRAIN_DISABLED,
  BRAIN_SUBJECTS,
  BRAIN_ACTIONS,
  SUBJECT_LABELS,
  ACTION_LABELS,
} from "./constants";

// Database accessor (shared, used by achat module)
export { brainDb } from "./services/brainDb";
export type { BrainEventRow, BrainRuleRow } from "./services/brainDb";
