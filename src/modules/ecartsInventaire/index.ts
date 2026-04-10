/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE: ecartsInventaire — Public API (Barrel Export)
 * ═══════════════════════════════════════════════════════════════
 *
 * Isolated observer module for inventory discrepancy tracking.
 * Removal: delete this folder + remove tab from InventairePage.
 *
 * Does NOT modify: StockEngine, products_v2, stock_events,
 * inventory_lines, zone_stock_snapshots, or any other module.
 * ═══════════════════════════════════════════════════════════════
 */

// Components
export { DiscrepancyListView } from "./components/DiscrepancyListView";

// Hooks (for external wiring)
export { useOpenDiscrepancyCount } from "./hooks/useDiscrepancies";
export { useCreateDiscrepancy } from "./hooks/useCreateDiscrepancy";

// Types
export type {
  InventoryDiscrepancy,
  DiscrepancyWithDetails,
  DiscrepancyStatus,
  CreateDiscrepancyParams,
} from "./types";
