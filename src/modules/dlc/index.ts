/**
 * DLC V1 — Module barrel export.
 *
 * This module is fully isolated and can be removed by:
 * 1. Deleting this folder (src/modules/dlc/)
 * 2. Removing ~20 lines from ReceptionDialog.tsx
 * 3. Removing ~15 lines from CommandeDetailDialog.tsx
 * 4. Dropping the reception_lot_dlc table
 * 5. Dropping the dlc_alert_settings table
 * 6. Dropping products_v2.dlc_warning_days column
 */

// Types
export type { ReceptionLotDlc, DlcStatus, DlcUpsertInput } from "./types";
export { DLC_DEFAULT_WARNING_DAYS } from "./types";

// Pure logic (SSOT computation + threshold resolution)
export {
  computeDlcStatus,
  computeDlcDaysRemaining,
  formatDlcDate,
  dlcUrgencyComparator,
  resolveDlcWarningDays,
} from "./lib/dlcCompute";
export type { DlcThresholdContext } from "./lib/dlcCompute";

// Components
export { DlcBadge } from "./components/DlcBadge";
export { DlcLineDetailSheet } from "./components/DlcLineDetailSheet";
export { DlcSupplierNotice } from "./components/DlcSupplierNotice";
export { DlcReceptionSummaryDialog } from "./components/DlcReceptionSummaryDialog";
export type { DlcLineIssue, DlcLineDecision } from "./components/DlcReceptionSummaryDialog";
export { DlcCritiquePage } from "./components/DlcCritiquePage";
export { DlcAlertSettingsPanel } from "./components/DlcAlertSettingsPanel";
export { DlcRequiredProductsPanel } from "./components/DlcRequiredProductsPanel";

// Hooks
export { useDlcForCommande } from "./hooks/useDlcForCommande";
export { useDlcUpsert, useDlcBatchUpsert } from "./hooks/useDlcMutations";
export { useDlcCritique } from "./hooks/useDlcCritique";
export { useDlcIssuesDetection } from "./hooks/useDlcIssuesDetection";
export type { DlcDetectionLine } from "./hooks/useDlcIssuesDetection";
export { useDlcRefusalToReturn } from "./hooks/useDlcRefusalToReturn";
export { useDlcRequiredProducts } from "./hooks/useDlcRequiredProducts";
export { useDlcAlertSettings, useUpsertDlcAlertSettings } from "./hooks/useDlcAlertSettings";
export { useDlcThresholdResolver } from "./hooks/useDlcThresholdResolver";
export { useUpdateDlcDate, useDismissDlcAlert } from "./hooks/useDlcCritiqueActions";

// Services
export { upsertDlc, batchUpsertDlc, getDlcForCommande } from "./services/dlcService";
