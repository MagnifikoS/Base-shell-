/**
 * Extra events and R-Extra realtime channels.
 * - extra_events: approved extras affect payroll
 * - planning_rextra_events: R-Extra balance recalculation
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidatePayroll, invalidatePlanning } from "../invalidators";

export function useExtraEventsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidatePayroll(queryClient, establishmentId);
    // Also invalidate extras queries for presence module
    queryClient.invalidateQueries({
      queryKey: ["extras", establishmentId],
      exact: false,
    });
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-extra-events-${establishmentId}`,
    table: "extra_events",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "extra_events change -> invalidating payroll + extras",
  });
}

export function useRextraEventsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidatePlanning(queryClient, establishmentId);
    invalidatePayroll(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-rextra-events-${establishmentId}`,
    table: "planning_rextra_events",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "planning_rextra_events change -> invalidating planning + payroll",
  });
}
