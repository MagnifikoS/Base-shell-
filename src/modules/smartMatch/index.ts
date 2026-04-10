/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — Module Index (Public API)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Module isolé et supprimable : rm -rf src/modules/smartMatch/
 * Pour supprimer : retirer l'import dans les modules consommateurs
 * et le feature flag dans featureFlags.ts.
 *
 * SSOT produit : products_v2 (READ ONLY)
 * Apprentissage : supplier_product_aliases + brain_rules (WRITE)
 */

// Main API (single entry point)
export { smartMatch } from "./api/smartMatchApi";

// Learning (post human validation)
export { smartMatchLearn } from "./store/smartMatchStore";

// UI Components
export { SmartMatchDrawer } from "./components/SmartMatchDrawer";
export { SmartMatchButton } from "./components/SmartMatchButton";

// Hook
export { useSmartMatch } from "./hooks/useSmartMatch";

// Types (contract)
export type {
  SmartMatchRequest,
  SmartMatchResponse,
  SmartMatchCandidate,
  SmartMatchLearnParams,
  MatchReason,
} from "./types";

// Engine utilities (for advanced consumers)
export { normalizeLabel, buildNormalizedKey, textSimilarity } from "./engine/normalize";
