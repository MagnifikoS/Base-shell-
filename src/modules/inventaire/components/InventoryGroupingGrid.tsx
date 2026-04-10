/**
 * Re-export from shared component.
 *
 * The actual implementation lives in @/components/shared/GroupingGrid.
 * This file provides backward-compatible aliases (InventoryGroupingGrid = GroupingGrid).
 */

export {
  GroupingGrid as InventoryGroupingGrid,
  GroupBackHeader,
} from "@/components/shared/GroupingGrid";
export type { GroupItem } from "@/components/shared/GroupingGrid";
