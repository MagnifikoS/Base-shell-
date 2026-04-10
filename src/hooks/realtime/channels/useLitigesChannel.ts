/**
 * Litiges realtime channel — invalidates litiges + commandes queries
 * on any change to litiges or litige_lines tables.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";

export function useLitigesChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["litiges"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["commandes"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["unified-commandes-products"], exact: false });
  }, [queryClient]);

  useRealtimeChannel({
    channelName: `app-litiges-${establishmentId}`,
    table: "litiges",
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "litiges change -> invalidating litiges + commandes",
  });

  useRealtimeChannel({
    channelName: `app-litige-lines-${establishmentId}`,
    table: "litige_lines",
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "litige_lines change -> invalidating litiges",
  });
}
