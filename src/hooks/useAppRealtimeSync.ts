/**
 * PHASE 2.7 — Global Realtime Sync Hook (SINGLE SOURCE OF TRUTH)
 *
 * Provides cross-tab/cross-device instant sync for:
 * - badge_events -> presence, alerts, absence, badge-status, late, extras
 * - planning_shifts -> planning-week (shifts data)
 * - planning_weeks -> planning-week (validation state)
 * - cash_day_reports -> cash-day, cash-month
 * - personnel_leaves -> planning-week, payroll (CP/repos/absences)
 * - stock_events -> estimated-stock, stock-alerts, desktop-stock, stock-documents-posted
 * - inventory_sessions -> inventory-sessions, desktop-stock, zone-lines-stats-batch
 * - inventory_lines -> inventory-lines, desktop-stock, estimated-stock, stock-alerts
 * - notification_events -> notification toasts + badge count
 *
 * Mounted ONCE in AppLayout. No local duplicates.
 *
 * CHANNELS CREATED: 17 (all critical tables)
 *
 * ROLLBACK: git revert of commit
 */

import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidatePresence, invalidatePlanning, invalidateCash } from "./realtime/invalidators";
import type { UseAppRealtimeSyncParams } from "./realtime/types";
import { CHANNEL_COUNT } from "./realtime/types";

// Channel hooks
import { useBadgeChannel } from "./realtime/channels/useBadgeChannel";
import {
  usePlanningShiftsChannel,
  usePlanningWeeksChannel,
} from "./realtime/channels/usePlanningChannels";
import {
  useExtraEventsChannel,
  useRextraEventsChannel,
} from "./realtime/channels/useExtraChannels";
import { useEmployeeDetailsChannel } from "./realtime/channels/useEmployeeChannel";
import { usePayrollValidationChannel } from "./realtime/channels/usePayrollValidationChannel";
import { useCashReportsChannel } from "./realtime/channels/useCashChannel";
import {
  usePersonnelLeavesChannel,
  useLeaveRequestsChannel,
} from "./realtime/channels/useLeaveChannels";
import {
  useInvoiceSuppliersChannel,
  useInvoicesChannel,
  useInvoiceStatementsChannel,
} from "./realtime/channels/useInvoiceChannels";
import { useStockEventsChannel } from "./realtime/channels/useStockEventsChannel";
import {
  useInventorySessionsChannel,
  useInventoryLinesChannel,
} from "./realtime/channels/useInventoryChannels";
import { useNotificationEventsChannel } from "./realtime/channels/useNotificationEventsChannel";

import {
  useBlWithdrawalDocumentsChannel,
  useBlWithdrawalLinesChannel,
} from "./realtime/channels/useBlWithdrawalChannel";
import { useCommandesChannel } from "./realtime/channels/useCommandesChannel";
import { useLitigesChannel } from "./realtime/channels/useLitigesChannel";

export type { UseAppRealtimeSyncParams };

export function useAppRealtimeSync({
  establishmentId,
  organizationId,
  enabled = true,
}: UseAppRealtimeSyncParams) {
  const queryClient = useQueryClient();
  const mountLoggedRef = useRef(false);

  // DEV-only: Log mount info once
  useEffect(() => {
    if (import.meta.env.DEV && enabled && establishmentId && !mountLoggedRef.current) {
      // eslint-disable-next-line no-console
      console.log(
        `[AppRealtimeSync] Mounting orchestrator for ${establishmentId} — ${CHANNEL_COUNT} channels`
      );
      mountLoggedRef.current = true;
    }
    return () => {
      mountLoggedRef.current = false;
    };
  }, [enabled, establishmentId]);

  /**
   * Tab visibility/focus handler - refetch on return
   */
  const handleRefreshOnFocus = useCallback(() => {
    if (!establishmentId) return;
    invalidatePresence(queryClient, establishmentId);
    invalidatePlanning(queryClient, establishmentId);
    invalidateCash(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useEffect(() => {
    if (!enabled || !establishmentId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleRefreshOnFocus();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleRefreshOnFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleRefreshOnFocus);
    };
  }, [enabled, establishmentId, handleRefreshOnFocus]);

  // Mount all 19 channel subscriptions (17 + commandes + litiges)
  useBadgeChannel(establishmentId, enabled);
  usePlanningShiftsChannel(establishmentId, enabled);
  usePlanningWeeksChannel(establishmentId, enabled);
  useExtraEventsChannel(establishmentId, enabled);
  useEmployeeDetailsChannel(establishmentId, organizationId, enabled);
  useRextraEventsChannel(establishmentId, enabled);
  usePayrollValidationChannel(establishmentId, enabled);
  useCashReportsChannel(establishmentId, enabled);
  usePersonnelLeavesChannel(establishmentId, enabled);
  useLeaveRequestsChannel(establishmentId, enabled);
  useInvoiceSuppliersChannel(establishmentId, enabled);
  useInvoicesChannel(establishmentId, enabled);
  useInvoiceStatementsChannel(establishmentId, enabled);
  useStockEventsChannel(establishmentId, enabled);
  useInventorySessionsChannel(establishmentId, enabled);
  useInventoryLinesChannel(establishmentId, enabled);
  useNotificationEventsChannel(establishmentId, enabled);
  
  useBlWithdrawalDocumentsChannel(establishmentId, enabled);
  useBlWithdrawalLinesChannel(establishmentId, enabled);
  useCommandesChannel(establishmentId, enabled);
  useLitigesChannel(establishmentId, enabled);
}
