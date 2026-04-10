/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE MUTUALISATION INVENTAIRE — Public API (Barrel Export)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Presentation-only layer for grouping similar products in inventory display.
 * This module does NOT modify products_v2, stock_events, or any other module.
 *
 * Safe to remove: `rm -rf src/modules/inventaireMutualisation/`
 * then remove imports from InventaireSettingsPage.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Components
export { MutualisationToggle } from "./components/MutualisationToggle";
export { GroupManagerPanel } from "./components/GroupManagerPanel";
export { SuggestionDialog } from "./components/SuggestionDialog";
export { ManualGroupDialog } from "./components/ManualGroupDialog";
export { GroupedStockRow } from "./components/GroupedStockRow";
export { B2bPriceResolution } from "./components/B2bPriceResolution";

// Hooks
export { useMutualisationEnabled } from "./hooks/useMutualisationEnabled";
export { useSuggestGroups } from "./hooks/useSuggestGroups";
export { useMutualisationGroups } from "./hooks/useMutualisationGroups";
export { useDismissedSuggestions } from "./hooks/useDismissedSuggestions";
export { useB2bResolution } from "./hooks/useB2bResolution";
export type { B2bResolutionResult, B2bResolvedData } from "./hooks/useB2bResolution";

// Pure functions (presentation transforms)
export { applyMutualisation } from "./utils/applyMutualisation";
export type { MutualisationDisplayItem } from "./utils/applyMutualisation";
export { applyMutualisationAlerts } from "./utils/applyMutualisationAlerts";
export type { AlertDisplayItem } from "./utils/applyMutualisationAlerts";

// B2B Billing Orchestrator (pure functions, no conversion logic)
export { resolveB2bBillingUnit } from "./utils/resolveB2bBillingUnit";
export type {
  BillingUnitResolution,
  ProductForBillingResolution,
} from "./utils/resolveB2bBillingUnit";

// B2B Price Resolver (uses BFS RPC, no local conversion)
export { resolveB2bPrices } from "./services/resolveB2bPrice";
export type { MemberPrice, PriceResolution, PriceStrategy } from "./services/resolveB2bPrice";

// Utils (pure functions)
export { extractKernel, jaccardSimilarity, areNamesSimilar, SIMILARITY_THRESHOLD } from "./utils/nameKernel";

// Types
export type { MutualisableProduct, SuggestedGroup, MutualisationGroup } from "./types";
