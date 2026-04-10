/**
 * Realtime sync module — barrel export.
 *
 * All realtime subscriptions are centralized here and mounted ONCE
 * in AppLayout via useAppRealtimeSync.
 */

// Generic hook
export { useRealtimeChannel } from "./useRealtimeChannel";
export type { RealtimeChannelConfig } from "./useRealtimeChannel";

// Low-level helpers
export { createRealtimeChannel, removeChannel } from "./createRealtimeChannel";

// Invalidation helpers
export {
  invalidatePresence,
  invalidatePlanning,
  invalidateCash,
  invalidatePayroll,
  invalidateEmployees,
} from "./invalidators";

// Types
export type { UseAppRealtimeSyncParams } from "./types";
export { CHANNEL_COUNT } from "./types";

// Channel hooks
export { useBadgeChannel } from "./channels/useBadgeChannel";
export { usePlanningShiftsChannel, usePlanningWeeksChannel } from "./channels/usePlanningChannels";
export { useExtraEventsChannel, useRextraEventsChannel } from "./channels/useExtraChannels";
export { useEmployeeDetailsChannel } from "./channels/useEmployeeChannel";
export { usePayrollValidationChannel } from "./channels/usePayrollValidationChannel";
export { useCashReportsChannel } from "./channels/useCashChannel";
export { usePersonnelLeavesChannel, useLeaveRequestsChannel } from "./channels/useLeaveChannels";
export {
  useInvoiceSuppliersChannel,
  useInvoicesChannel,
  useInvoiceStatementsChannel,
} from "./channels/useInvoiceChannels";
export {
  useBlWithdrawalDocumentsChannel,
  useBlWithdrawalLinesChannel,
} from "./channels/useBlWithdrawalChannel";
export { useCommandesChannel } from "./channels/useCommandesChannel";
export { useLitigesChannel } from "./channels/useLitigesChannel";
