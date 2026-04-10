/**
 * Badge events realtime channel.
 * Invalidates presence + payroll queries on badge clock-in/out changes.
 * Dispatches notifications for late arrivals and absences.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidatePresence, invalidatePayroll } from "../invalidators";

export function useBadgeChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(
    () => {
      if (!establishmentId) return;
      invalidatePresence(queryClient, establishmentId);
      invalidatePayroll(queryClient, establishmentId);
    },
    [queryClient, establishmentId]
  );

  useRealtimeChannel({
    channelName: `app-badge-events-${establishmentId}`,
    table: "badge_events",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "badge_events change -> invalidating presence + payroll",
  });
}
