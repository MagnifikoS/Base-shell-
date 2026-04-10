/**
 * ===============================================================================
 * MODULE INVENTAIRE — Public API (Barrel Export)
 * ===============================================================================
 *
 * Single entry point for the inventaire module.
 * Other modules MUST import through this file, never deep-import internal files.
 *
 * Pages are exported as default lazy-compatible imports (used in App.tsx).
 * ===============================================================================
 */

// Pages
export { default as InventairePage } from "./pages/InventairePage";
export { default as InventaireSettingsPage } from "./pages/InventaireSettingsPage";

// Types (used externally by produitsV2 types via ConditioningConfig reference)
export type {
  InventorySession,
  InventoryLine,
  InventoryLineWithProduct,
  InventoryZoneProduct,
  InventoryStatus,
  ZoneInventoryStatus,
  ZoneWithInventoryStatus,
} from "./types";

// Components (used by produitsV2 list page)
export { InventoryGroupingGrid, GroupBackHeader } from "./components/InventoryGroupingGrid";
export type { GroupItem } from "./components/InventoryGroupingGrid";
