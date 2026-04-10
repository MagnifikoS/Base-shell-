/**
 * orderPrep — Public API for the "À commander" memo module
 *
 * 100% isolated: can be removed by deleting this folder +
 * removing 1 tab in CommandesList + 1 field in MobileStockListView.
 */

export { OrderPrepTab } from "./components/OrderPrepTab";
export { useOrderPrepForProduct } from "./hooks/useOrderPrepForProduct";
export { useUpsertOrderPrep } from "./hooks/useOrderPrepMutations";
export type { OrderPrepLine, SupplierPrepSummary } from "./types";
