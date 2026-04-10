/**
 * Cash day reports realtime channel.
 * Formerly in useCashRealtimeSync, now consolidated here.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidateCash } from "../invalidators";

export function useCashReportsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidateCash(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-cash-reports-${establishmentId}`,
    table: "cash_day_reports",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "cash_day_reports change -> invalidating cash",
  });
}
