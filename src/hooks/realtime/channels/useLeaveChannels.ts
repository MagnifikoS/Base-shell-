/**
 * Leave-related realtime channels.
 * - personnel_leaves: CP/repos/absences affect planning + payroll
 * - personnel_leave_requests: Demandes workflow for employee + manager views
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidatePlanning, invalidatePayroll } from "../invalidators";

export function usePersonnelLeavesChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    // Invalidate planning (shows leaves on grid) + payroll (CP/absence counts)
    invalidatePlanning(queryClient, establishmentId);
    invalidatePayroll(queryClient, establishmentId);
    // Invalidate my-all-absences for Conges & Absences module (employee view)
    queryClient.invalidateQueries({
      queryKey: ["my-all-absences", establishmentId],
      exact: false,
    });
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-personnel-leaves-${establishmentId}`,
    table: "personnel_leaves",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "personnel_leaves change -> invalidating planning + payroll + my-all-absences",
  });
}

export function useLeaveRequestsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    // Invalidate leave requests queries (employee + manager views)
    queryClient.invalidateQueries({
      queryKey: ["leave-requests", "my", establishmentId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["leave-requests", "manager", establishmentId],
      exact: false,
    });
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-leave-requests-${establishmentId}`,
    table: "personnel_leave_requests",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "personnel_leave_requests change -> invalidating leave-requests",
  });
}
