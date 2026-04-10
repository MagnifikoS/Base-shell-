/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — Index Export (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Page
export { default as AchatPage } from "./AchatPage";

// Types
export * from "./types";

// Services
export { createPurchaseLines, fetchMonthlyPurchaseSummary } from "./services/purchaseService";

// Hooks
export { usePurchases } from "./hooks/usePurchases";

// Purchase line builder utils (used by VisionAI state)
export { buildPurchaseLineInputs } from "./utils/buildPurchaseLines";
export type { ResolvedProductLine } from "./utils/buildPurchaseLines";
