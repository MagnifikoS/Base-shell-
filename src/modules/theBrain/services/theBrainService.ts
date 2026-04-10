/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Service (Barrel re-export)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Split into:
 * - brainDb.ts — Shared database accessor
 * - brainEventsService.ts — Events (logEvent, brainSafeLog, health summary)
 * - brainProductRulesService.ts — Product matching rules
 * - brainSupplierRulesService.ts — Supplier matching rules
 *
 * This file re-exports everything for backward compatibility.
 * All existing imports from "./services/theBrainService" continue to work.
 */

// Events
export {
  logEvent,
  brainSafeLog,
  getHealthSummary,
  getSubjectsSummary,
  getRecentEvents,
} from "./brainEventsService";

// Product matching rules
export {
  upsertProductMatchingRule,
  getBestProductRuleSuggestion,
  getProductMatchingRules,
} from "./brainProductRulesService";

export type {
  UpsertProductRuleParams,
  BrainProductSuggestion,
  GetProductSuggestionParams,
} from "./brainProductRulesService";

// Supplier matching rules
export {
  upsertSupplierMatchingRule,
  getBestSupplierRuleSuggestion,
} from "./brainSupplierRulesService";
